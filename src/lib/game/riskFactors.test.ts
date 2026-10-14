// Squads SQ-4 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md sections 4 and 5): the pure risk
// building blocks. The factor scale and names (user #11), the per-tier odds (user #11, within tolerance on a seeded
// histogram), enemy territory, the per-body jitter and lifeless worlds, the hostile sites (user #12) and their
// no-softlock gate (user #3), the generated needs, the difficulty rating, the risk reward on the D23 curve (user #6),
// the ambush chance and flora.

import { describe, expect, it } from "vitest";
import { PLANET_TYPES } from "./expeditionContent";
import {
  AMBUSH_CHANCE_BY_GRADE,
  DIFFICULTY_NAMES,
  DIFFICULTY_WEIGHTS,
  FLORA_WORK_SLOW_PER_GRADE,
  HOSTILE_SITE_RULES,
  RISK_FACTOR_NAMES,
  RISK_GRADE_NAMES,
  RISK_REWARD_KNEE,
  RISK_REWARD_PER_WEIGHT,
  RISK_TIER_ODDS,
  bodyRiskGrades,
  difficultyGradeOf,
  difficultyName,
  difficultyWeight,
  expeditionRegion,
  floraWorkMult,
  generateRiskProfile,
  generatedTaskNeeds,
  hazardGrade,
  hostileSiteFieldable,
  riskAmbushChance,
  riskFlavor,
  riskRewardBonus,
  systemRiskGrades,
  taskDifficultyScore,
  taskChainFollowUp,
  tierNeeds,
  type ExpeditionRegion,
} from "./riskFactors";
import { diminishing } from "./diminishing";
import type { RegionTier, RiskGrade } from "./model";

const TIERS: RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const region = (tier: RegionTier, enemyTerritory = false): ExpeditionRegion => ({ tier, enemyTerritory });
const seedOf = (i: number) => (Math.imul(i + 1, 0x2545f491) ^ 0x9e3779b9) >>> 0;

describe("SQ-4 the factors and the scale (user #11)", () => {
  it("names the four factors on None / Low / Moderate / High / Extreme, with a flavor line per step", () => {
    expect(RISK_GRADE_NAMES).toEqual(["None", "Low", "Moderate", "High", "Extreme"]);
    expect(RISK_FACTOR_NAMES).toEqual({ combat: "Combat risk", fauna: "Fauna", flora: "Flora", hazard: "Hazard" });
    expect(riskFlavor("combat", 3)).toBe("Enemy territory");
    expect(riskFlavor("fauna", 4)).toBe("Apex predators");
    expect(riskFlavor("flora", 1)).toBe("Sparse growth");
    expect(riskFlavor("combat", 0)).toBeNull();
    expect(riskFlavor("hazard", 2)).toBeNull();
  });

  it("bands the body hazard: None below 0.15, Low below 0.3, Moderate below 0.5, High below 0.7, else Extreme", () => {
    const byType = Object.fromEntries(PLANET_TYPES.map((p) => [p.id, hazardGrade(p.hazard)]));
    expect(byType).toEqual({ terrestrial: 0, ocean: 2, arid: 1, volcanic: 3, frozen: 2, gasGiant: 0, barren: 0, toxic: 4 });
    expect([0.149, 0.15, 0.299, 0.3, 0.499, 0.5, 0.699, 0.7].map(hazardGrade)).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(hazardGrade(Number.NaN)).toBe(0);
  });

  it("today every candidate is Tier I outside enemy territory (G2 supplies the regions) [PROVISIONAL]", () => {
    expect(expeditionRegion(12345)).toEqual({ tier: 1, enemyTerritory: false });
  });
});

describe("SQ-4 generation: the per-tier odds (user #11), deterministic on RISK_SALT", () => {
  it("every tier's table has five weights summing to 100", () => {
    for (const tier of TIERS) {
      for (const row of [RISK_TIER_ODDS[tier].combat, RISK_TIER_ODDS[tier].life]) {
        expect(row).toHaveLength(5);
        expect(row.reduce((a, b) => a + b, 0)).toBe(100);
      }
    }
  });

  it("a seeded histogram per tier matches its table within 2.5 points (combat, fauna and flora)", () => {
    const N = 4000;
    for (const tier of TIERS) {
      const counts = { combat: [0, 0, 0, 0, 0], fauna: [0, 0, 0, 0, 0], flora: [0, 0, 0, 0, 0] };
      for (let i = 0; i < N; i += 1) {
        const g = systemRiskGrades(seedOf(i), region(tier));
        counts.combat[g.combat] += 1;
        counts.fauna[g.fauna] += 1;
        counts.flora[g.flora] += 1;
      }
      for (const [factor, row] of Object.entries(counts)) {
        const table = factor === "combat" ? RISK_TIER_ODDS[tier].combat : RISK_TIER_ODDS[tier].life;
        for (let g = 0; g < 5; g += 1) {
          expect(Math.abs((100 * row[g]) / N - table[g]), `tier ${tier} ${factor} grade ${g}`).toBeLessThan(2.5);
          if (table[g] === 0) expect(row[g], `tier ${tier} ${factor} grade ${g} never drawn`).toBe(0);
        }
      }
    }
  });

  it("known enemy territory adds one step of combat (capped at Extreme); fauna and flora are untouched", () => {
    for (let i = 0; i < 300; i += 1) {
      const calm = systemRiskGrades(seedOf(i), region(5));
      const hostile = systemRiskGrades(seedOf(i), region(5, true));
      expect(hostile.combat).toBe(Math.min(4, calm.combat + 1));
      expect({ fauna: hostile.fauna, flora: hostile.flora }).toEqual({ fauna: calm.fauna, flora: calm.flora });
    }
  });

  it("a body reads the system's grade or one step below (about 30% drop); Fauna / Flora None on lifeless worlds", () => {
    let drops = 0;
    let total = 0;
    const sys = { combat: 3 as RiskGrade, fauna: 3 as RiskGrade, flora: 3 as RiskGrade };
    for (let i = 0; i < 2000; i += 1) {
      const b = bodyRiskGrades(seedOf(i), region(4), sys, i % 3, { planetType: "terrestrial", hazard: 0.1 });
      for (const g of [b.combat, b.fauna, b.flora]) {
        expect([2, 3]).toContain(g);
        total += 1;
        if (g === 2) drops += 1;
      }
      expect(b.hazard).toBe(0);
    }
    expect(Math.abs((100 * drops) / total - 30)).toBeLessThan(2.5);
    for (const planetType of ["barren", "volcanic", "gasGiant"] as const) {
      const b = bodyRiskGrades(7, region(4), sys, 0, { planetType, hazard: 0.1 });
      expect([b.fauna, b.flora]).toEqual([0, 0]);
      expect(b.combat).toBeGreaterThan(0);
    }
    const frozen = bodyRiskGrades(7, region(4), sys, 0, { planetType: "frozen", hazard: 0.4 });
    expect(frozen.flora).toBe(0);
    expect(frozen.fauna).toBeGreaterThan(0);
    expect(frozen.hazard).toBe(2);
  });

  it("is a pure function of (seed, region, bodies): the same inputs give the same profile; bodies are keyed by index", () => {
    const bodies = [
      { planetType: "terrestrial" as const, hazard: 0.1 },
      { planetType: "toxic" as const, hazard: 0.9 },
    ];
    const a = generateRiskProfile(0xabcdef, region(3), bodies);
    expect(generateRiskProfile(0xabcdef, region(3), bodies)).toEqual(a);
    expect(a.profile).toMatchObject({ version: 1, tier: 3, enemyTerritory: false });
    // Body 0's grades do not depend on how many bodies follow it.
    expect(generateRiskProfile(0xabcdef, region(3), bodies.slice(0, 1)).bodies[0]).toEqual(a.bodies[0]);
    expect(a.bodies[1].hazard).toBe(4);
  });
});

describe("SQ-4 hostile sites (user #12) and the no-softlock gate (user #3)", () => {
  const sys = (combat: RiskGrade) => ({ combat, fauna: 0 as RiskGrade, flora: 0 as RiskGrade });
  const siteRate = (tier: RegionTier, combat: RiskGrade, site: string): number => {
    // Grades held at the system's own (a seed whose combat jitter did not drop), so the rate reads the grade.
    let n = 0;
    let hits = 0;
    for (let i = 0; n < 4000; i += 1) {
      const b = bodyRiskGrades(seedOf(i), region(tier), sys(combat), 0, { planetType: "terrestrial", hazard: 0.1 });
      if (b.combat !== combat) continue;
      n += 1;
      if (b.site === site) hits += 1;
    }
    return (100 * hits) / n;
  };

  it("an Enemy Colony appears from Tier III on High (15%) or Extreme (30%) combat bodies, never below", () => {
    expect(Math.abs(siteRate(3, 3, "enemyColony") - 15)).toBeLessThan(2.5);
    expect(Math.abs(siteRate(3, 4, "enemyColony") - 30)).toBeLessThan(2.5);
    expect(siteRate(3, 2, "enemyColony")).toBe(0);
    expect(siteRate(2, 4, "enemyColony")).toBe(0);
  });

  it("an Enemy Fortification appears from Tier VI on Extreme combat bodies (10%), one site per body at most", () => {
    expect(Math.abs(siteRate(6, 4, "enemyFortification") - 10)).toBeLessThan(2.5);
    expect(siteRate(5, 4, "enemyFortification")).toBe(0);
    expect(siteRate(6, 3, "enemyFortification")).toBe(0);
    expect(HOSTILE_SITE_RULES.enemyColony).toMatchObject({ fightPoints: 4, needs: { security: 2, science: 1 } });
    expect(HOSTILE_SITE_RULES.enemyFortification).toMatchObject({ fightPoints: 5, needs: { security: 4, science: 0 } });
  });

  it("a site is fielded only when the deployed squads cover it AND keep a Science squad", () => {
    const sq = (security: number, science: number) => ({ security, science });
    // Every 4-squad composition: Ground + Ground, Strike + Survey, Strike + Ground, Survey + Ground.
    expect([sq(2, 2), sq(2, 2), sq(3, 1), sq(1, 3)].map((d) => hostileSiteFieldable("enemyColony", d))).toEqual([true, true, true, false]);
    expect([sq(2, 2), sq(3, 1), sq(1, 3)].some((d) => hostileSiteFieldable("enemyFortification", d))).toBe(false);
    // A bigger hull: 4 Security squads and a Science squad fields it; 4 Security and no Science would softlock.
    expect(hostileSiteFieldable("enemyFortification", sq(4, 1))).toBe(true);
    expect(hostileSiteFieldable("enemyFortification", sq(4, 0))).toBe(false);
    expect(hostileSiteFieldable("enemyColony", sq(1, 1))).toBe(false);
  });
});

describe("SQ-4 needs from risk (design 3.2); safe tiers adapt, later tiers stand as rolled (user 2026-10-13)", () => {
  it("Security 0 / 1 / 2 by fight points; 2 Science at the big digs from Tier II; a hostile site's own needs", () => {
    expect([0, 1, 3, 4, 5].map((fp) => generatedTaskNeeds("mineralOutcrop", fp, 1).security)).toEqual([0, 1, 1, 2, 2]);
    expect(generatedTaskNeeds("ancientRuins", 2, 1)).toEqual({ security: 1, science: 1 });
    for (const poi of ["ancientRuins", "buriedVault", "subterraneanCivilization"]) expect(generatedTaskNeeds(poi, 2, 2).science).toBe(2);
    expect(generatedTaskNeeds("caveNetwork", 2, 7).science).toBe(1);
    expect(generatedTaskNeeds("enemyColony", 4, 3)).toEqual({ security: 2, science: 1 });
    expect(generatedTaskNeeds("enemyFortification", 5, 6)).toEqual({ security: 4, science: 0 });
  });

  it("Tiers I and II never ask for more than one squad of each type; from Tier III the generated needs stand", () => {
    for (const tier of [1, 2]) {
      expect(tierNeeds({ security: 2, science: 2 }, tier)).toEqual({ security: 1, science: 1 });
      expect(tierNeeds({ security: 0, science: 2 }, tier)).toEqual({ security: 0, science: 1 });
      expect(tierNeeds({ security: 1, science: 0 }, tier)).toEqual({ security: 1, science: 0 });
    }
    for (const tier of [3, 5, 7]) {
      expect(tierNeeds({ security: 2, science: 2 }, tier)).toEqual({ security: 2, science: 2 });
      expect(tierNeeds({ security: 4, science: 0 }, tier)).toEqual({ security: 4, science: 0 });
    }
    // So at Tier II the big digs' 2 Science squads only ask once Tier III is reached (the safe practice zone).
    expect(tierNeeds(generatedTaskNeeds("ancientRuins", 2, 2), 2)).toEqual({ security: 1, science: 1 });
    expect(tierNeeds(generatedTaskNeeds("ancientRuins", 2, 3), 3)).toEqual({ security: 1, science: 2 });
  });
});

describe("SQ-4 difficulty (design section 4)", () => {
  it("scores fight points + hazard band + extra squads + half the combat grade, graded Simple to Deadly", () => {
    const n = (security: number, science: number) => ({ security, science });
    expect(taskDifficultyScore({ fightPoints: 0, hazard: 0.1, needs: n(0, 1), combat: 0 })).toBe(0);
    expect(taskDifficultyScore({ fightPoints: 2, hazard: 0.4, needs: n(1, 1), combat: 1 })).toBe(4);
    expect(taskDifficultyScore({ fightPoints: 5, hazard: 0.9, needs: n(4, 0), combat: 4 })).toBe(12);
    expect(taskDifficultyScore({ fightPoints: 1, hazard: 0.65, needs: n(1, 1), combat: 3 })).toBe(1 + 2 + 1 + 1);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 12].map(difficultyGradeOf)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(DIFFICULTY_NAMES).toEqual(["Simple", "Standard", "Challenging", "Dangerous", "Deadly"]);
    expect(difficultyName(4)).toBe("Dangerous");
  });

  it("weights completion 1 / 2 / 3 / 5 / 8; an unrated or corrupt grade weighs 1", () => {
    expect(DIFFICULTY_WEIGHTS).toEqual([1, 2, 3, 5, 8]);
    expect([1, 2, 3, 4, 5].map(difficultyWeight)).toEqual([1, 2, 3, 5, 8]);
    for (const bad of [undefined, 0, 6, 2.5, Number.NaN]) {
      expect(difficultyWeight(bad)).toBe(1);
      expect(difficultyName(bad)).toBeNull();
    }
  });
});

describe("SQ-4 the risk reward (user #6: the greater the risk, the greater the reward), on the D23 curve", () => {
  it("is 0 for a Simple or unrated task and rises with every grade, each step worth less per weight", () => {
    const bonus = [1, 2, 3, 4, 5].map(riskRewardBonus);
    expect(bonus[0]).toBe(0);
    expect(riskRewardBonus(undefined)).toBe(0);
    for (let g = 1; g < 5; g += 1) expect(bonus[g]).toBeGreaterThan(bonus[g - 1]);
    for (let g = 1; g < 5; g += 1) {
      expect(bonus[g]).toBeCloseTo(diminishing(RISK_REWARD_PER_WEIGHT * (DIFFICULTY_WEIGHTS[g] - 1), RISK_REWARD_KNEE), 12);
      // Concave: below the linear rate (D23 "they mean less and less"), never capped.
      expect(bonus[g]).toBeLessThan(RISK_REWARD_PER_WEIGHT * (DIFFICULTY_WEIGHTS[g] - 1));
    }
    expect(bonus[4]).toBeGreaterThan(0.4);
    expect(bonus[4]).toBeLessThan(0.5);
  });
});

describe("SQ-4 the ambush chance and flora", () => {
  it("the ambush chance reads the worse of combat and fauna", () => {
    expect(AMBUSH_CHANCE_BY_GRADE[0]).toBe(0);
    expect(riskAmbushChance({ combat: 0, fauna: 0 })).toBe(0);
    expect(riskAmbushChance({ combat: 1, fauna: 3 })).toBe(AMBUSH_CHANCE_BY_GRADE[3]);
    expect(riskAmbushChance({ combat: 4, fauna: 0 })).toBe(AMBUSH_CHANCE_BY_GRADE[4]);
  });

  it("flora slows work by 5% a grade; no risk (every run before SQ-4) is exactly 1", () => {
    expect(floraWorkMult({})).toBe(1);
    expect(floraWorkMult({ risk: { flora: 0 } })).toBe(1);
    expect(floraWorkMult({ risk: { flora: 4 } })).toBeCloseTo(1 + 4 * FLORA_WORK_SLOW_PER_GRADE, 12);
  });

  it("TASK CHAINS (user #14) is a hook only: no follow-up yet", () => {
    expect(taskChainFollowUp("enemyFortification")).toBeNull();
  });
});
