// Objective affixes (AF-1): the pure affix module (affixes.ts). The catalog and its colors, the pools keyed by
// (region tier, difficulty, difficulty tier), the stamping roll, the per-landing reinforcement roll, the alert,
// its escalation and the Impossible failsafe.

import { describe, expect, it } from "vitest";
import {
  AFFIX_DEFS,
  AFFIX_ORDER,
  ALERT_DIFFICULTY_PER_LEVEL,
  ESCALATION_ENEMIES_PER_LEVEL,
  IMPOSSIBLE_DIFFICULTY_SCORE,
  AFFIX_RANK_WEIGHTS_BY_TIER,
  REINFORCEMENT_COUNT_WEIGHTS,
  REINFORCING_RANKS,
  affixColorClass,
  affixLabel,
  affixPill,
  affixPool,
  alertAfterSetback,
  alertLevelAt,
  alertResetSeconds,
  alertResetsAt,
  escalationAt,
  extraBattleChance,
  maxExtraBattles,
  objectiveDifficultyAt,
  objectiveHeld,
  objectiveHeldUntil,
  raisesAlert,
  rankNumeral,
  rollObjectiveAffixes,
  rollReinforcements,
  validAffixes,
  type AffixRollInput,
  type ObjectiveAffix,
} from "./affixes";
import { BASE_DIFFICULTY_TIER, generateRiskProfile, runDifficultyTier } from "./riskFactors";
import { diminishing } from "./diminishing";
import type { ExpeditionActivity } from "./model";

const R = (rank: number): ObjectiveAffix => ({ id: "reinforcing", rank, alignment: "negative" });

describe("AF-1 the catalog: Reinforcing, ranks, alignments, colors", () => {
  it("Reinforcing is always negative, combat objectives only, ranks I to X, required on Deadly", () => {
    const def = AFFIX_DEFS.reinforcing;
    // AF-2 appended Rocky Outcroppings at the END (catalog 2); Reinforcing is AF-1's (catalog 1).
    expect(AFFIX_ORDER).toEqual(["reinforcing", "rockyOutcroppings"]);
    expect(def.catalog).toBe(1);
    expect(def.name).toBe("Reinforcing");
    expect(def.alignments).toEqual(["negative"]);
    expect(def.appliesTo).toEqual(["combatObjective"]);
    expect(def.maxRank).toBe(10);
    expect(def.requiredFromDifficulty).toBe(5);
  });

  it("the rank table: the user's 25 / 35 / 40% and X at 50% for up to 5 battles; the reset grows with rank", () => {
    expect(REINFORCING_RANKS.map((r) => r.chance)).toEqual([0.25, 0.35, 0.4, 0.42, 0.44, 0.46, 0.47, 0.48, 0.49, 0.5]);
    expect(REINFORCING_RANKS.map((r) => r.maxBattles)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    for (let i = 1; i < REINFORCING_RANKS.length; i += 1) expect(REINFORCING_RANKS[i].resetSeconds).toBeGreaterThan(REINFORCING_RANKS[i - 1].resetSeconds);
    expect(extraBattleChance([R(1)])).toBeCloseTo(0.25, 12);
    expect(extraBattleChance([R(10)])).toBeCloseTo(0.5, 12);
    expect(maxExtraBattles([R(3)])).toBe(2);
    expect(maxExtraBattles([R(10)])).toBe(5);
    expect(alertResetSeconds([R(1)])).toBe(1800);
    expect(raisesAlert([R(1)])).toBe(true);
    expect(raisesAlert([])).toBe(false);
    expect(extraBattleChance(undefined)).toBe(0);
  });

  it("alignment colors: green / yellow / red; labels and the pill", () => {
    expect(affixColorClass("positive")).toBe("green");
    expect(affixColorClass("neutral")).toBe("yellow");
    expect(affixColorClass("negative")).toBe("red");
    expect(rankNumeral(3)).toBe("III");
    expect(rankNumeral(10)).toBe("X");
    expect(affixLabel(R(3))).toBe("Reinforcing III");
    const pill = affixPill(R(10));
    expect(pill).toMatchObject({ label: "Reinforcing X", color: "red", alignment: "Negative" });
    expect(pill.tooltip).toContain("50%");
    expect(pill.tooltip).toContain("up to 5 extra battles");
    expect(affixPill(R(1)).tooltip).toContain("an extra battle");
    for (const text of [pill.tooltip, AFFIX_DEFS.reinforcing.help]) {
      expect(text.includes(String.fromCharCode(0x2014))).toBe(false); // no em dash
      expect(text.includes("-".repeat(2))).toBe(false); // no double hyphen
      expect(text).not.toMatch(/\bfit(ting)?\b/i);
    }
  });

  it("validAffixes drops unknown ids, out-of-range ranks and alignments the affix does not allow", () => {
    const bad = [
      R(0),
      R(11),
      R(2.5),
      { id: "nope", rank: 1, alignment: "negative" },
      { id: "reinforcing", rank: 1, alignment: "positive" },
      R(4),
    ] as ObjectiveAffix[];
    expect(validAffixes(bad)).toEqual([R(4)]);
  });
});

describe("AF-1 pools keyed by (tier, difficulty, difficulty tier)", () => {
  it("a Deadly combat objective REQUIRES Reinforcing (never in the rollable entries); a calm one gets nothing", () => {
    // AF-1's catalog (a run dispatched before AF-2): Reinforcing only.
    const deadly = affixPool(1, 5, BASE_DIFFICULTY_TIER, "combatObjective", 1);
    expect(deadly.required).toEqual(["reinforcing"]);
    expect(deadly.entries).toEqual([]);
    const easy = affixPool(3, 2, BASE_DIFFICULTY_TIER, "combatObjective", 1);
    expect(easy.required).toEqual([]);
    expect(easy.entries).toEqual([{ id: "reinforcing", weight: 100 }]);
    const calm = affixPool(7, 5, BASE_DIFFICULTY_TIER, "calmObjective", 1);
    expect(calm.required).toEqual([]);
    expect(calm.entries).toEqual([]);
    // AF-2's catalog (the default): Rocky Outcroppings joins the rollable entries of combat objectives only.
    expect(affixPool(1, 5, BASE_DIFFICULTY_TIER, "combatObjective").entries).toEqual([{ id: "rockyOutcroppings", weight: 100 }]);
    expect(affixPool(3, 2, BASE_DIFFICULTY_TIER, "combatObjective").entries).toEqual([
      { id: "reinforcing", weight: 100 },
      { id: "rockyOutcroppings", weight: 100 },
    ]);
    expect(affixPool(7, 5, BASE_DIFFICULTY_TIER, "calmObjective").entries).toEqual([]);
  });

  it("the roll chance is rarer on early tiers and easier objectives", () => {
    const c = (tier: number, d: number) => affixPool(tier, d, BASE_DIFFICULTY_TIER, "combatObjective").rollChance;
    expect(c(1, 4)).toBeLessThan(c(3, 4));
    expect(c(3, 4)).toBeLessThan(c(7, 4));
    expect(c(3, 1)).toBeLessThan(c(3, 4));
    expect(c(1, 4)).toBeLessThanOrEqual(0.01);
  });

  it("the difficulty tier is a key: the base tier reads as built, an unknown one reads as the base (nothing more built)", () => {
    expect(affixPool(4, 3, BASE_DIFFICULTY_TIER, "combatObjective")).toEqual(affixPool(4, 3, BASE_DIFFICULTY_TIER, "combatObjective"));
    expect(affixPool(4, 3, 2, "combatObjective")).toEqual(affixPool(4, 3, BASE_DIFFICULTY_TIER, "combatObjective"));
    // The profile carries it: its presence is the affix flag.
    const profile = generateRiskProfile(123, { tier: 1, enemyTerritory: false }, [{ planetType: "terrestrial", hazard: 0.1 }]).profile;
    expect(profile.difficultyTier).toBe(BASE_DIFFICULTY_TIER);
    expect(runDifficultyTier(profile)).toBe(BASE_DIFFICULTY_TIER);
    expect(runDifficultyTier({ ...profile, difficultyTier: undefined })).toBeNull();
    expect(runDifficultyTier(undefined)).toBeNull();
  });
});

describe("AF-1 the stamping roll (AFFIX_ROLL_SALT, fixed draw layout)", () => {
  const input = (over: Partial<AffixRollInput>): AffixRollInput => ({
    seed: 0x5eed,
    bodyIndex: 0,
    taskIndex: 0,
    tier: 1,
    difficulty: 3,
    difficultyTier: BASE_DIFFICULTY_TIER,
    combat: true,
    ...over,
  });

  it("is deterministic and keyed by the objective", () => {
    const a = rollObjectiveAffixes(input({ difficulty: 5, tier: 6, taskIndex: 3 }));
    expect(rollObjectiveAffixes(input({ difficulty: 5, tier: 6, taskIndex: 3 }))).toEqual(a);
    const ranks = new Set<number>();
    for (let k = 0; k < 200; k += 1) ranks.add(rollObjectiveAffixes(input({ difficulty: 5, tier: 7, taskIndex: k }))[0].rank);
    expect(ranks.size).toBeGreaterThan(3); // the key moves the draws
  });

  it("every Deadly combat objective carries Reinforcing (negative), whatever the tier; a calm one never does", () => {
    for (let k = 0; k < 300; k += 1) {
      for (const tier of [1, 4, 7]) {
        const out = rollObjectiveAffixes(input({ difficulty: 5, tier, taskIndex: k, seed: k * 7919 }));
        // AF-2: a Deadly objective may also roll Rocky Outcroppings (after the required Reinforcing).
        expect(out.length).toBeGreaterThanOrEqual(1);
        expect(out[0]).toMatchObject({ id: "reinforcing", alignment: "negative" });
        if (out.length > 1) expect(out.slice(1).map((a) => a.id)).toEqual(["rockyOutcroppings"]);
        const af1 = rollObjectiveAffixes(input({ difficulty: 5, tier, taskIndex: k, seed: k * 7919, catalog: 1 }));
        expect(af1.length).toBe(1);
        expect(af1[0]).toMatchObject({ id: "reinforcing", alignment: "negative" });
        expect(rollObjectiveAffixes(input({ difficulty: 5, tier, taskIndex: k, combat: false }))).toEqual([]);
      }
    }
  });

  it("ranks are tier- and difficulty-gated: Tier I is always rank I, ranks above III only from Tier IV and Dangerous", () => {
    const ranksAt = (tier: number, difficulty: number): number[] => {
      const out: number[] = [];
      for (let k = 0; k < 2000; k += 1) {
        const a = rollObjectiveAffixes(input({ tier, difficulty, taskIndex: k, seed: 0xabc }));
        if (a.length > 0) out.push(a[0].rank);
      }
      return out;
    };
    expect(new Set(ranksAt(1, 5))).toEqual(new Set([1]));
    // At the BASE difficulty tier the top ranks are VERY rare (user: Reinforcing X belongs to the future
    // max-difficulty tiers): IX and X only at Tier VII, 1% each.
    const top = AFFIX_RANK_WEIGHTS_BY_TIER[7];
    const total = top.reduce((a, b) => a + b, 0);
    expect(top[8] / total).toBeLessThanOrEqual(0.01);
    expect(top[9] / total).toBeLessThanOrEqual(0.01);
    for (const tier of [1, 2, 3, 4, 5, 6] as const) expect(AFFIX_RANK_WEIGHTS_BY_TIER[tier].length).toBeLessThan(9);
    expect(Math.max(...ranksAt(3, 5))).toBeLessThanOrEqual(3);
    const high = ranksAt(7, 5);
    expect(Math.max(...high)).toBeGreaterThan(5);
    expect(high.filter((r) => r > 3).length / high.length).toBeLessThan(0.8);
    // A Challenging objective at Tier VII is capped at rank III.
    for (let k = 0; k < 3000; k += 1) {
      const a = rollObjectiveAffixes(input({ tier: 7, difficulty: 3, taskIndex: k }));
      for (const x of a) expect(x.rank).toBeLessThanOrEqual(3);
    }
  });

  it("easier combat objectives roll it rarely, and seldom on early planets", () => {
    const rate = (tier: number, difficulty: number): number => {
      let hits = 0;
      const n = 20_000;
      for (let k = 0; k < n; k += 1) if (rollObjectiveAffixes(input({ tier, difficulty, taskIndex: k, bodyIndex: k % 5 })).length > 0) hits += 1;
      return hits / n;
    };
    const t1 = rate(1, 3);
    const t5 = rate(5, 3);
    expect(t1).toBeLessThan(0.01);
    expect(t5).toBeGreaterThan(t1);
    expect(t5).toBeLessThan(0.06);
  });
});

describe("AF-1 the per-visit reinforcement roll (REINFORCEMENT_SALT, integer draws)", () => {
  it("rank I strikes about 25% of visits with exactly one battle; rank X about 50% with 1 to 5", () => {
    let hits1 = 0;
    let hitsX = 0;
    const counts = new Map<number, number>();
    const n = 8000;
    for (let v = 0; v < n; v += 1) {
      const one = rollReinforcements(0xfeed, 2, v, [R(1)]);
      if (one.length > 0) {
        hits1 += 1;
        expect(one.length).toBe(1);
      }
      const ten = rollReinforcements(0xfeed, 2, v, [R(10)]);
      if (ten.length > 0) {
        hitsX += 1;
        counts.set(ten.length, (counts.get(ten.length) ?? 0) + 1);
        // Strike points: ascending fractions strictly inside the bar still ahead.
        for (let k = 0; k < ten.length; k += 1) {
          expect(ten[k]).toBeGreaterThan(0);
          expect(ten[k]).toBeLessThan(1);
          if (k > 0) expect(ten[k]).toBeGreaterThanOrEqual(ten[k - 1]);
        }
      }
    }
    expect(hits1 / n).toBeGreaterThan(0.22);
    expect(hits1 / n).toBeLessThan(0.28);
    expect(hitsX / n).toBeGreaterThan(0.46);
    expect(hitsX / n).toBeLessThan(0.54);
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(rollReinforcements(0xfeed, 2, 7, [R(10)])).toEqual(rollReinforcements(0xfeed, 2, 7, [R(10)]));
    expect(rollReinforcements(0xfeed, 2, 7, [])).toEqual([]);
  });

  it("the count is WEIGHTED TOWARD FEWER (user): 1 most likely, each larger count rarer, the maximum rarest", () => {
    expect(REINFORCEMENT_COUNT_WEIGHTS).toEqual([50, 25, 13, 8, 4]);
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 40_000;
    for (let v = 0; v < n; v += 1) counts[rollReinforcements(0xbeef, 5, v, [R(10)]).length] += 1;
    const hits = n - counts[0];
    for (let c = 2; c <= 5; c += 1) expect(counts[c]).toBeLessThan(counts[c - 1]);
    expect(counts[1] / hits).toBeGreaterThan(0.46);
    expect(counts[1] / hits).toBeLessThan(0.54);
    expect(counts[5] / hits).toBeLessThan(0.06);
    // Rank III (at most 2): one battle about two thirds of the time.
    let one = 0;
    let two = 0;
    for (let v = 0; v < n; v += 1) {
      const k = rollReinforcements(0xbeef, 5, v, [R(3)]).length;
      if (k === 1) one += 1;
      if (k === 2) two += 1;
    }
    expect(one / (one + two)).toBeGreaterThan(0.62);
    expect(one / (one + two)).toBeLessThan(0.71);
  });
});

describe("AF-1 the alert: setbacks, decay, escalation, the Impossible failsafe", () => {
  type T = Pick<ExpeditionActivity, "affixes" | "alert" | "difficulty" | "difficultyScore">;
  const task = (over: Partial<T> = {}): T => ({ affixes: [R(1)], difficulty: 5, difficultyScore: 8, ...over });

  it("each setback raises the level and restarts the clock; it lapses resetSeconds after the last one", () => {
    const t0 = task();
    expect(alertLevelAt(t0, 0)).toBe(0);
    const a1 = alertAfterSetback(t0, 1000)!;
    expect(a1).toEqual({ level: 1, lastAt: 1000 });
    const t1 = task({ alert: a1 });
    expect(alertLevelAt(t1, 1000)).toBe(1);
    expect(alertResetsAt(t1)).toBe(2800);
    expect(alertLevelAt(t1, 2799.999)).toBe(1);
    expect(alertLevelAt(t1, 2800)).toBe(0);
    const t2 = task({ alert: alertAfterSetback(t1, 2000)! });
    expect(t2.alert).toEqual({ level: 2, lastAt: 2000 });
    expect(alertResetsAt(t2)).toBe(3800);
    // After a lapse a setback starts again at 1.
    expect(alertAfterSetback(t2, 5000)).toEqual({ level: 1, lastAt: 5000 });
    // No alert-raising affix: no alert.
    expect(alertAfterSetback(task({ affixes: undefined }), 10)).toBeNull();
    // Higher ranks hold longer.
    expect(alertResetsAt(task({ affixes: [R(10)], alert: { level: 1, lastAt: 0 } }))).toBe(7200);
  });

  it("escalation: one more enemy per level and a Heightened Senses damage buff on the D23 curve (never capped)", () => {
    expect(escalationAt(0)).toEqual({ extraEnemies: 0, damageMult: 1 });
    const m = [1, 2, 3, 6, 20].map((l) => escalationAt(l).damageMult);
    expect(escalationAt(3).extraEnemies).toBe(3 * ESCALATION_ENEMIES_PER_LEVEL);
    expect(m[0]).toBeCloseTo(1 + diminishing(0.2, 1), 12);
    for (let i = 1; i < m.length; i += 1) expect(m[i]).toBeGreaterThan(m[i - 1]);
    // Each stack is worth a bit less than the one before.
    expect(m[1] - m[0]).toBeLessThan(m[0] - 1);
    expect(m[2] - m[1]).toBeLessThan(m[1] - m[0]);
    expect(escalationAt(1000).damageMult).toBeGreaterThan(escalationAt(500).damageMult);
  });

  it("the rating rises with the alert; Impossible only once ALERTED past the line, then held until the reset", () => {
    const at = (level: number, score = 8) => task({ difficultyScore: score, alert: level > 0 ? { level, lastAt: 0 } : undefined });
    expect(objectiveDifficultyAt(at(0), 10)).toMatchObject({ grade: 5, name: "Deadly", score: 8, impossible: false });
    expect(objectiveDifficultyAt(at(2), 10)).toMatchObject({ grade: 5, score: 8 + 2 * ALERT_DIFFICULTY_PER_LEVEL, impossible: false });
    const three = objectiveDifficultyAt(at(3), 10)!;
    expect(three.score).toBe(IMPOSSIBLE_DIFFICULTY_SCORE);
    expect(three).toMatchObject({ grade: 6, name: "Impossible", impossible: true });
    expect(objectiveHeld(at(3), 10)).toBe(true);
    expect(objectiveHeldUntil(at(3), 10)).toBe(1800);
    // The countdown ends at the reset: the objective is back to normal.
    expect(objectiveHeld(at(3), 1800)).toBe(false);
    expect(objectiveDifficultyAt(at(3), 1800)).toMatchObject({ grade: 5, impossible: false });
    expect(objectiveHeldUntil(at(3), 1800)).toBeNull();
    // A site scored past the line on its own is never Impossible without an alert (it would wait forever).
    expect(objectiveDifficultyAt(at(0, 12), 0)).toMatchObject({ grade: 5, impossible: false });
    expect(objectiveHeld(at(1, 12), 0)).toBe(true);
    // A Standard objective that rolled Reinforcing climbs one score step per level.
    expect(objectiveDifficultyAt(task({ difficulty: 2, difficultyScore: 3, alert: { level: 1, lastAt: 0 } }), 0)).toMatchObject({ grade: 3, name: "Challenging" });
    // A risk-aware task stamped before AF-1 reads its stored grade; an unrated one reads null.
    expect(objectiveDifficultyAt({ difficulty: 4 }, 0)).toMatchObject({ grade: 4, score: null, impossible: false });
    expect(objectiveDifficultyAt({}, 0)).toBeNull();
  });
});
