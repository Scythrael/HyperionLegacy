// Field Kits FKR-1 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-1): the pure enemy ranks module.
// The catalog (user N1: one multiplier on HP and power), the placement (user N2 corrected, N3, N5: only the final
// fight of a Challenging objective is led by an Elite, of a Dangerous or Deadly one by a Boss), the training run seam
// and the record / display helpers. The engine wiring lives in groundOpsRanks.test.ts.

import { describe, expect, it } from "vitest";
import type { Expedition } from "./model";
import { generateEncounter, type GroundCombatant } from "./gambit";
import {
  ENEMY_RANKS,
  ENEMY_RANKS_VERSION,
  ENEMY_RANK_IDS,
  EARLIER_FIGHT_LEAD,
  FINAL_FIGHT_LEAD,
  REINFORCEMENT_RANK,
  fightLeadRank,
  fightRankContext,
  isTrainingRun,
  rankAtLeast,
  rankedEnemies,
  rankedEnemyName,
  ranksLive,
  withEnemyRanks,
  type EnemyRank,
  type FightRankContext,
} from "./enemyRanks";

// A real guard: a Derelict Outpost on a calm world (its Striker hits hardest).
const guard = (): GroundCombatant[] => generateEncounter(0x5eed, 0, "derelictOutpost");
const final = (grade: number | undefined, over: Partial<FightRankContext> = {}): FightRankContext => ({
  grade,
  pointIndex: 2,
  fightPointCount: 3,
  kind: "point",
  trainingRun: false,
  ...over,
});

describe("FKR-1 the rank catalog (user N1: one multiplier on HP and power)", () => {
  it("Weak 0.7, Normal 1, Strong 1.3, Elite 1.7, Boss 2.5, weakest to strongest, with the user's names", () => {
    expect(ENEMY_RANK_IDS).toEqual(["weak", "normal", "strong", "elite", "boss"]);
    expect(ENEMY_RANK_IDS.map((r) => ENEMY_RANKS[r].mult)).toEqual([0.7, 1, 1.3, 1.7, 2.5]);
    expect(ENEMY_RANK_IDS.map((r) => ENEMY_RANKS[r].label)).toEqual(["Weak", "Normal", "Strong", "Elite", "Boss"]);
    expect(ENEMY_RANK_IDS.map((r) => ENEMY_RANKS[r].order)).toEqual([0, 1, 2, 3, 4]);
    expect(Object.keys(ENEMY_RANKS).sort()).toEqual([...ENEMY_RANK_IDS].sort());
    expect(ENEMY_RANKS_VERSION).toBe(1);
  });

  it("the leads by grade: finals Simple / Standard none, Challenging and Dangerous an Elite, Deadly a Boss; earlier fights Strong on Dangerous only", () => {
    expect(FINAL_FIGHT_LEAD).toEqual([null, null, "elite", "elite", "boss"]); // user "Soften Dangerous", 2026-10-16
    expect(EARLIER_FIGHT_LEAD).toEqual([null, null, null, "strong", null]); // user "Use them on the curve", 2026-10-16
    expect(REINFORCEMENT_RANK).toBe("normal"); // user N5
  });
});

describe("FKR-1 withEnemyRanks: the lead takes the rank, everyone else stays Normal", () => {
  for (const rank of ENEMY_RANK_IDS) {
    it(`${rank}: the strongest enemy's hp, hpMax, power, heal and threat take x${ENEMY_RANKS[rank].mult}; the rest are untouched`, () => {
      const before = guard();
      const after = withEnemyRanks(guard(), rank);
      const m = ENEMY_RANKS[rank].mult;
      const leadAt = before.reduce((best, e, i) => (e.power > before[best].power ? i : best), 0);
      expect(before[leadAt].role).toBe("striker");
      after.forEach((e, i) => {
        const b = before[i];
        expect(e.id).toBe(b.id); // the role tag stays in the id
        if (i === leadAt) {
          expect(e.rank).toBe(rank);
          expect(e.hp).toBe(Math.max(1, Math.round(b.hp * m)));
          expect(e.hpMax).toBe(Math.max(1, Math.round(b.hpMax * m)));
          expect(e.power).toBe(b.power * m);
          expect(e.heal).toBe(b.heal * m);
          expect(e.threat).toBe(b.threat * m);
          expect({ ...e, rank: undefined, hp: b.hp, hpMax: b.hpMax, power: b.power, heal: b.heal, threat: b.threat }).toEqual({ ...b, rank: undefined });
        } else {
          expect(e).toEqual({ ...b, rank: "normal" });
        }
      });
    });
  }

  it("ties go to the first in list order; an empty guard is left empty", () => {
    const twins = generateEncounter(0x5eed, 0, "enemyFortification"); // two Strikers lead the garrison
    const strikers = twins.filter((e) => e.role === "striker");
    expect(strikers.length).toBe(2);
    expect(strikers[0].power).toBe(strikers[1].power);
    expect(Math.max(...twins.map((e) => e.power))).toBe(strikers[0].power);
    const ranked = withEnemyRanks(twins, "boss");
    expect(ranked.filter((e) => e.rank === "boss").map((e) => e.id)).toEqual([strikers[0].id]);
    expect(withEnemyRanks([], "boss")).toEqual([]);
  });

  it("returns the same list it mutates (the fight hands it a fresh guard)", () => {
    const list = guard();
    expect(withEnemyRanks(list, "elite")).toBe(list);
  });
});

describe("FKR-1 fightLeadRank: the final point of a Challenging or harder objective, and a Dangerous one's earlier points", () => {
  it("the final point by grade 1 to 5: Normal, Normal, Elite, Elite, Boss", () => {
    expect([1, 2, 3, 4, 5].map((g) => fightLeadRank(final(g)))).toEqual(["normal", "normal", "elite", "elite", "boss"]);
  });

  it("an earlier point by grade 1 to 5: Normal, Normal, Normal, Strong, Normal (Strong leads only on Dangerous)", () => {
    for (const p of [0, 1]) expect([1, 2, 3, 4, 5].map((g) => fightLeadRank(final(g, { pointIndex: p })))).toEqual(["normal", "normal", "normal", "strong", "normal"]);
  });

  it("Weak is never placed here (the curve's low end is SF-3's)", () => {
    for (const g of [1, 2, 3, 4, 5]) for (const p of [0, 1, 2]) for (const kind of ["point", "surprise", "reinforcement"] as const) expect(fightLeadRank(final(g, { pointIndex: p, kind }))).not.toBe("weak");
  });

  it("a surprise fight and a reinforcement fight are Normal, on the final point and before it (user N5)", () => {
    for (const g of [3, 4, 5]) {
      for (const p of [0, 2]) {
        expect(fightLeadRank(final(g, { kind: "surprise", pointIndex: p }))).toBe("normal");
        expect(fightLeadRank(final(g, { kind: "reinforcement", pointIndex: p }))).toBe("normal");
      }
    }
  });

  it("a training run fields every enemy Normal (user: never on a training run)", () => {
    for (const g of [1, 2, 3, 4, 5]) for (const p of [0, 2]) expect(fightLeadRank(final(g, { trainingRun: true, pointIndex: p }))).toBe("normal");
  });

  it("an unrated objective (legacy, before SQ-4), a corrupt grade or no fight points: Normal", () => {
    for (const g of [undefined, 0, 6, 2.5, Number.NaN]) expect(fightLeadRank(final(g))).toBe("normal");
    expect(fightLeadRank(final(5, { fightPointCount: 0, pointIndex: 0 }))).toBe("normal");
    expect(fightLeadRank(final(5, { pointIndex: 3 }))).toBe("normal"); // past the last point
  });

  it("a one-point objective's only fight is its final fight", () => {
    expect(fightLeadRank(final(4, { pointIndex: 0, fightPointCount: 1 }))).toBe("elite");
    expect(fightLeadRank(final(5, { pointIndex: 0, fightPointCount: 1 }))).toBe("boss");
  });

  it("fightRankContext reads the task's stamped grade and the point fought for, and the run's training stamp", () => {
    const task = { difficulty: 4, pointsCleared: 2 };
    expect(fightRankContext({}, task, 3)).toEqual({ grade: 4, pointIndex: 2, fightPointCount: 3, kind: "point", trainingRun: false });
    expect(fightRankContext({ difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1 } }, task, 3, "reinforcement")).toEqual({
      grade: 4,
      pointIndex: 2,
      fightPointCount: 3,
      kind: "reinforcement",
      trainingRun: true,
    });
    expect(fightRankContext({}, {}, 0).pointIndex).toBe(0);
  });
});

describe("FKR-1 the flags: enemy ranks and the training run seam", () => {
  it("ranksLive reads Expedition.enemyRanks (absent or a bad version: not ranked)", () => {
    expect(ranksLive({})).toBe(false);
    expect(ranksLive({ enemyRanks: { version: ENEMY_RANKS_VERSION } })).toBe(true);
    expect(ranksLive({ enemyRanks: { version: 0 } })).toBe(false);
    expect(ranksLive({ enemyRanks: { version: Number.NaN } })).toBe(false);
  });

  it("isTrainingRun reads the safe first runs stamp (Expedition.difficulty.firstRun); absent = not a training run", () => {
    expect(isTrainingRun({})).toBe(false);
    expect(isTrainingRun({ difficulty: undefined })).toBe(false);
    expect(isTrainingRun({ difficulty: null } as unknown as Expedition)).toBe(false);
    expect(isTrainingRun({ difficulty: { version: 1, firstRun: false, ramp: 0.5, tier: 1 } })).toBe(false);
    expect(isTrainingRun({ difficulty: { version: 1, firstRun: true, ramp: 0, tier: 1 } })).toBe(true);
    expect(isTrainingRun({ difficulty: { firstRun: "yes" } } as unknown as Expedition)).toBe(false);
  });
});

describe("FKR-1 the record and display helpers", () => {
  it("rankedEnemies lists every enemy not Normal, or nothing", () => {
    expect(rankedEnemies(withEnemyRanks(guard(), "normal"))).toBeUndefined();
    expect(rankedEnemies(guard())).toBeUndefined(); // an unranked guard
    expect(rankedEnemies(withEnemyRanks(guard(), "boss"))).toEqual({ "enemy-striker-1": "boss" });
    expect(rankedEnemies([{ id: "a", rank: "weak" }, { id: "b" }, { id: "c", rank: "elite" }])).toEqual({ a: "weak", c: "elite" });
  });

  it('rankedEnemyName: "Elite Bruiser"; a Normal or unranked enemy is just its role name', () => {
    expect(rankedEnemyName("elite", "Bruiser")).toBe("Elite Bruiser");
    expect(rankedEnemyName("boss", "Caster")).toBe("Boss Caster");
    expect(rankedEnemyName("weak", "Swarm")).toBe("Weak Swarm");
    expect(rankedEnemyName("normal", "Striker")).toBe("Striker");
    expect(rankedEnemyName(undefined, "Healer")).toBe("Healer");
  });

  it("rankAtLeast orders the ranks (FKR-6's 'Elite or stronger'); absent reads Normal", () => {
    const at = (r: EnemyRank | undefined) => ENEMY_RANK_IDS.filter((min) => rankAtLeast(r, min));
    expect(at("boss")).toEqual(ENEMY_RANK_IDS);
    expect(at("elite")).toEqual(["weak", "normal", "strong", "elite"]);
    expect(at(undefined)).toEqual(["weak", "normal"]);
    expect(at("weak")).toEqual(["weak"]);
  });
});
