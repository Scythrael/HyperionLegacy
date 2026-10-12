// Ground Operations (GO-6): the THREAT INDICATOR, display only. A Monte Carlo of the task's remaining fights on
// the threat's OWN salted stream, mapped to the 7 named tiers. Samples follow the user's carry-damage rule
// (Q5): within a sample each fight starts from the previous fight's end state, the first from the task's
// current carried state, and members downed earlier in the sample sit out its later fights. A threat read never
// changes a real fight.

import { describe, it, expect } from "vitest";
import { DEFAULT_MEMBER_GAMBIT, type Expedition, type ExpeditionActivity, type ExpeditionBody, type SnapshotMember } from "./model";
import { threatAssessment, tierAtLeast } from "./combat/threatAssessment";
import {
  GROUND_FIGHT_SALT,
  resolveTaskFight,
  resolveTaskFightOnSeed,
  taskFightSeed,
  type GroundFightTeam,
  type GroundMemberCarry,
} from "./groundFight";
import { fightPointCount } from "./groundTasks";
import {
  GROUND_THREAT_MEMO_SIZE,
  GROUND_THREAT_SALT,
  GROUND_THREAT_SAMPLES,
  HELPER_MIN_TIER,
  groundTaskClearOdds,
  groundTaskThreat,
  groundThreatMemoSize,
  groundThreatOddsKey,
  groundThreatSampleFights,
  groundThreatSampleSeed,
  remainingTaskFights,
} from "./groundThreat";

// ===== Fixtures (the GO-5 shapes) =====

const ZERO_STATS = { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 };

function sec(memberId: string, stats: Partial<typeof ZERO_STATS> = {}): SnapshotMember {
  return {
    memberId,
    teamType: "security",
    spec: "offense",
    rank: 1,
    rankFactor: 1,
    traits: [],
    groundStats: { ...ZERO_STATS, ...stats },
    resists: {},
    implants: [],
    gear: [],
    gambit: DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r })),
    effects: [],
  };
}

function body(hazard: number): ExpeditionBody {
  return { id: "body-1", planetType: "toxic", scanTotal: 100, scanProgress: 0, hazard, scanned: true, discoveries: [], activities: [] };
}

function task(poiId: string, points: number, over: Partial<ExpeditionActivity> = {}): ExpeditionActivity {
  const fightPoints = Array.from({ length: points }, (_, k) => (k + 1) / (points + 1));
  return { id: "act-1", bodyId: "body-1", poiId, done: false, fightPoints, progress: 0, pointsCleared: 0, fightCount: 0, ...over };
}

function exp(security: SnapshotMember[], over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "activities",
    phaseAnchorSeconds: 0,
    shakedown: true,
    bodies: [body(0.2)],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 424242,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: { security: [], science: [] } as Expedition["gambitPrograms"],
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    roster: { security, science: [] },
    ...over,
  };
}

function wholeTeam(e: Expedition, downed: string[] = []): GroundFightTeam {
  return { securityIds: (e.roster?.security ?? []).map((m) => m.memberId), downedThisTask: downed, securityShare: 1 };
}

const GEARED = { hp: 4, power: 4, armor: 3, accuracy: 1 };
const strongExp = () => exp([sec("member-1", GEARED), sec("member-2", GEARED), sec("member-3", GEARED)], { securityStrength: 60 });
const loneExp = () => exp([sec("member-1")]);
// A middling squad whose odds are neither certain nor hopeless (so carry and sample effects can show).
const midExp = () => exp([sec("member-1", { hp: 1, power: 1 }), sec("member-2", { hp: 1, power: 1 })], { securityStrength: 10 });

// ===== Constants and the stream =====

describe("the threat's own salted sample stream (GO-6)", () => {
  it("pins the salt, the sample count and the helper floor", () => {
    expect(GROUND_THREAT_SALT).toBe(0x6e5b3c27);
    expect(GROUND_THREAT_SALT % 2).toBe(1);
    expect(GROUND_THREAT_SALT).not.toBe(GROUND_FIGHT_SALT);
    expect(GROUND_THREAT_SAMPLES).toBe(32);
    expect(HELPER_MIN_TIER).toBe("likely");
  });

  it("a sample seed is seed ^ GROUND_THREAT_SALT ^ flat index ^ sample ^ fight point, never a real fight's seed", () => {
    const e = strongExp();
    const want = (e.seed ^ GROUND_THREAT_SALT ^ Math.imul(7 + 1, 0x9e3779b9) ^ Math.imul(3 + 1, 0x85ebca6b) ^ Math.imul(2 + 1, 0x27d4eb2f)) >>> 0;
    expect(groundThreatSampleSeed(e, 7, 3, 2)).toBe(want);
    const seeds = new Set<number>();
    const real = new Set<number>();
    for (let s = 0; s < GROUND_THREAT_SAMPLES; s += 1) for (let j = 0; j < 5; j += 1) seeds.add(groundThreatSampleSeed(e, 7, s, j));
    for (let f = 0; f < 64; f += 1) real.add(taskFightSeed(e, 7, f));
    expect(seeds.size).toBe(GROUND_THREAT_SAMPLES * 5);
    for (const s of seeds) expect(real.has(s)).toBe(false);
  });
});

// ===== Remaining fights =====

describe("remainingTaskFights (GO-6)", () => {
  it("counts the task's fight points not yet cleared", () => {
    expect(remainingTaskFights(task("crashedShip", 3), body(0))).toBe(3);
    expect(remainingTaskFights(task("crashedShip", 3, { pointsCleared: 2 }), body(0))).toBe(1);
    expect(remainingTaskFights(task("crashedShip", 3, { pointsCleared: 3 }), body(0))).toBe(0);
    expect(remainingTaskFights(task("crashedShip", 3, { pointsCleared: 9 }), body(0))).toBe(0);
  });

  it("an unstamped task (no fightPoints yet) reads the site's count off the body's raw hazard", () => {
    const t: ExpeditionActivity = { id: "act-1", bodyId: "body-1", poiId: "derelictOutpost", done: false };
    expect(remainingTaskFights(t, body(0))).toBe(fightPointCount("derelictOutpost", 0));
    expect(remainingTaskFights(t, body(0.8))).toBe(fightPointCount("derelictOutpost", 0.8));
  });
});

// ===== Odds and tiers =====

describe("groundTaskClearOdds / groundTaskThreat (GO-6)", () => {
  it("is deterministic: same inputs, same odds and the same tier", () => {
    const e = midExp();
    const t = task("caveNetwork", 2);
    const a = groundTaskClearOdds(e, [wholeTeam(e)], body(0.3), t, 4);
    const b = groundTaskClearOdds(e, [wholeTeam(e)], body(0.3), t, 4);
    expect(a).toEqual(b);
    expect(a.samples).toBe(GROUND_THREAT_SAMPLES);
    expect(groundTaskThreat(e, [wholeTeam(e)], body(0.3), t, 4)).toEqual(threatAssessment(a.wins, a.samples));
  });

  it("a strong geared squad vs a 1-fight Mineral Outcrop reads Guaranteed or Likely", () => {
    const e = strongExp();
    const threat = groundTaskThreat(e, [wholeTeam(e)], body(0), task("mineralOutcrop", 1), 0);
    expect(tierAtLeast(threat.tier, "likely")).toBe(true);
  });

  it("a lone bare-handed member vs a 4-fight Subterranean Civilization reads Extreme or Impossible", () => {
    const e = loneExp();
    const threat = groundTaskThreat(e, [wholeTeam(e)], body(0.4), task("subterraneanCivilization", 4), 0);
    expect(["extreme", "impossible"]).toContain(threat.tier);
  });

  it("no remaining fights clears in every sample (Guaranteed), even with nobody to field", () => {
    const e = loneExp();
    const done = task("crashedShip", 3, { pointsCleared: 3 });
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0), done, 0)).toEqual({ wins: GROUND_THREAT_SAMPLES, samples: GROUND_THREAT_SAMPLES });
    expect(groundTaskThreat(exp([]), [], body(0), done, 0).tier).toBe("guaranteed");
  });

  it("nobody to field with fights remaining never wins (Impossible)", () => {
    const e = strongExp();
    const allDown = wholeTeam(e, ["member-1", "member-2", "member-3"]);
    expect(groundTaskClearOdds(e, [allDown], body(0), task("mineralOutcrop", 1), 0).wins).toBe(0);
    expect(groundTaskThreat(exp([]), [], body(0), task("mineralOutcrop", 1), 0).tier).toBe("impossible");
  });

  it("the sample count is a whole number of at least 1", () => {
    const e = midExp();
    const t = task("caveNetwork", 2);
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0), t, 0, 8).samples).toBe(8);
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0), t, 0, 0).samples).toBe(1);
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0), t, 0, 5.7).samples).toBe(5);
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0), t, 0, Number.NaN).samples).toBe(1);
    // The first 8 of 32 samples are the same 8 samples (a sample is keyed by its own index).
    const eight = groundTaskClearOdds(e, [wholeTeam(e)], body(0), t, 0, 8).wins;
    let firstEight = 0;
    for (let s = 0; s < 8; s += 1) if (groundThreatSampleFights(e, [wholeTeam(e)], body(0), t, 0, s).win) firstEight += 1;
    expect(eight).toBe(firstEight);
  });

  it("more fights left never reads better odds for the same squad and site", () => {
    const e = midExp();
    const one = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), task("derelictOutpost", 4, { pointsCleared: 3 }), 2).wins;
    const four = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), task("derelictOutpost", 4), 2).wins;
    expect(four).toBeLessThanOrEqual(one);
  });
});

// ===== Samples follow the carry-damage rule (user Q5) =====

describe("a threat sample plays the task like the engine will (carry damage, sit-outs)", () => {
  it("each fight starts from the previous fight's memberEnd, keyed by its own sample seed", () => {
    const e = midExp();
    const teams = [wholeTeam(e)];
    const t = task("derelictOutpost", 4, { pointsCleared: 1, fightCount: 3 });
    let checkedChain = false;
    for (let s = 0; s < GROUND_THREAT_SAMPLES; s += 1) {
      const sample = groundThreatSampleFights(e, teams, body(0.2), t, 5, s);
      expect(sample.fights.length).toBeGreaterThanOrEqual(1);
      let carry: Record<string, GroundMemberCarry> | undefined;
      const downed: string[] = [];
      sample.fights.forEach((rec, k) => {
        const j = 1 + k;
        const want = resolveTaskFightOnSeed(
          e,
          teams.map((tm) => ({ ...tm, downedThisTask: [...(tm.downedThisTask ?? []), ...downed] })),
          body(0.2),
          { ...t, pointsCleared: j, fightCount: 3 + k },
          groundThreatSampleSeed(e, 5, s, j),
          carry,
        );
        expect(rec).toEqual(want);
        expect(rec.pointIndex).toBe(j);
        carry = rec.memberEnd;
        downed.push(...rec.downedMemberIds);
        if (k > 0) checkedChain = true;
      });
      // A sample stops at its first loss and wins only when every remaining fight was won.
      const last = sample.fights[sample.fights.length - 1];
      expect(sample.win).toBe(sample.fights.length === 3 && sample.fights.every((f) => f.outcome === "win"));
      if (!sample.win) expect(last.outcome).toBe("loss");
    }
    expect(checkedChain).toBe(true);
  });

  it("a member downed earlier in a sample sits out its later fights", () => {
    const e = midExp();
    const teams = [wholeTeam(e)];
    const t = task("derelictOutpost", 4);
    let seen = false;
    for (let s = 0; s < GROUND_THREAT_SAMPLES; s += 1) {
      const { fights } = groundThreatSampleFights(e, teams, body(0.2), t, 1, s);
      const out = new Set<string>();
      for (const f of fights) {
        for (const id of out) {
          seen = true;
          expect(f.memberEnd[id]).toBeUndefined();
          expect(f.memberConditions[id]).toBeUndefined();
          expect(f.downedMemberIds).not.toContain(id);
        }
        for (const id of f.downedMemberIds) out.add(id);
      }
    }
    expect(seen).toBe(true);
  });

  it("the first fight starts from the task's current carried state: a hurt team reads worse odds", () => {
    const e = midExp();
    const teams = [wholeTeam(e)];
    const t = task("caveNetwork", 2);
    const fresh = groundTaskClearOdds(e, teams, body(0.2), t, 3);
    const hurt: Record<string, GroundMemberCarry> = { "member-1": { hp: 1, statuses: [] }, "member-2": { hp: 1, statuses: [] } };
    const odds = groundTaskClearOdds(e, teams, body(0.2), t, 3, GROUND_THREAT_SAMPLES, hurt);
    expect(odds.wins).toBeLessThan(fresh.wins);
    // The first fight of each sample is exactly the carried fight on that sample's seed.
    const first = groundThreatSampleFights(e, teams, body(0.2), t, 3, 0, hurt).fights[0];
    expect(first).toEqual(resolveTaskFightOnSeed(e, teams, body(0.2), t, groundThreatSampleSeed(e, 3, 0, 0), hurt));
  });

  it("teams' existing sit-outs are respected (a member downed earlier in the real task never fights)", () => {
    const e = midExp();
    const teams = [wholeTeam(e, ["member-2"])];
    for (let s = 0; s < 8; s += 1) {
      for (const f of groundThreatSampleFights(e, teams, body(0), task("caveNetwork", 2), 0, s).fights) {
        expect(f.memberEnd["member-2"]).toBeUndefined();
        expect(f.downedMemberIds).not.toContain("member-2");
      }
    }
  });
});

// ===== Display only =====

describe("a threat read never changes anything (GO-6)", () => {
  it("leaves every input deep-equal", () => {
    const e = midExp();
    const teams = [wholeTeam(e, [])];
    const b = body(0.3);
    const t = task("derelictOutpost", 4, { pointsCleared: 1, fightCount: 2 });
    const carried: Record<string, GroundMemberCarry> = { "member-1": { hp: 5, statuses: [{ id: "poison", magnitude: 2, remaining: 3 }] } };
    const before = JSON.parse(JSON.stringify({ e, teams, b, t, carried }));
    groundTaskClearOdds(e, teams, b, t, 2, GROUND_THREAT_SAMPLES, carried);
    groundTaskThreat(e, teams, b, t, 2, GROUND_THREAT_SAMPLES, carried);
    expect(JSON.parse(JSON.stringify({ e, teams, b, t, carried }))).toEqual(before);
  });

  it("the real fight's record is identical with and without a prior threat read", () => {
    const t = task("crashedShip", 3, { pointsCleared: 1, fightCount: 4 });
    const carried: Record<string, GroundMemberCarry> = { "member-1": { hp: 6, statuses: [] } };
    const freshE = midExp();
    const without = resolveTaskFight(freshE, [wholeTeam(freshE)], body(0.3), t, 6, carried);
    const e = midExp();
    groundTaskThreat(e, [wholeTeam(e)], body(0.3), t, 6, GROUND_THREAT_SAMPLES, carried);
    groundTaskClearOdds(e, [wholeTeam(e)], body(0.3), t, 6);
    const withRead = resolveTaskFight(e, [wholeTeam(e)], body(0.3), t, 6, carried);
    expect(withRead).toEqual(without);
  });
});

// ===== The memo (keyed on the whole input) =====

// The unmemoized count, straight from the samples.
function countWins(e: Expedition, teams: GroundFightTeam[], b: ExpeditionBody, t: ExpeditionActivity, flat: number, n: number, carried?: Record<string, GroundMemberCarry>): number {
  if (remainingTaskFights(t, b) === 0) return n;
  let wins = 0;
  for (let s = 0; s < n; s += 1) if (groundThreatSampleFights(e, teams, b, t, flat, s, carried).win) wins += 1;
  return wins;
}

describe("the threat memo (GO-6 performance)", () => {
  it("a memo hit returns exactly what a fresh computation does, as a fresh object", () => {
    const e = midExp();
    const t = task("derelictOutpost", 4);
    const a = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), t, 2);
    const b = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), t, 2);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(a.wins).toBe(countWins(e, [wholeTeam(e)], body(0.2), t, 2, GROUND_THREAT_SAMPLES));
    b.wins = -1; // a caller editing its copy never reaches the memo
    expect(groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), t, 2).wins).toBe(a.wins);
  });

  it("every input the read depends on is in the key (an edited input is a miss, never a stale hit)", () => {
    const e = midExp();
    const teams = [wholeTeam(e)];
    const t = task("derelictOutpost", 4);
    const base = groundThreatOddsKey(e, teams, body(0.2), t, 2, 32);
    const variants = [
      groundThreatOddsKey({ ...e, seed: e.seed + 1 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, id: "expedition-2" }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, securityStrength: 11 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, squadTriage: 0.1 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, squadFearResist: 0.1 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, hazardResist: 0.1 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, teamKit: 3 }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey({ ...e, roster: { security: [sec("member-1", { power: 2 }), sec("member-2")], science: [] } }, teams, body(0.2), t, 2, 32),
      groundThreatOddsKey(e, [{ ...teams[0], downedThisTask: ["member-2"] }], body(0.2), t, 2, 32),
      groundThreatOddsKey(e, [{ ...teams[0], securityShare: 0.5 }], body(0.2), t, 2, 32),
      groundThreatOddsKey(e, [{ ...teams[0], securityIds: ["member-1"] }], body(0.2), t, 2, 32),
      groundThreatOddsKey(e, teams, body(0.3), t, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), { ...t, id: "act-2" }, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), { ...t, poiId: "crashedShip" }, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), { ...t, fightCount: 1 }, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), { ...t, pointsCleared: 1 }, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), { ...t, fightPoints: [0.5] }, 2, 32),
      groundThreatOddsKey(e, teams, body(0.2), t, 3, 32),
      groundThreatOddsKey(e, teams, body(0.2), t, 2, 16),
      groundThreatOddsKey(e, teams, body(0.2), t, 2, 32, { "member-1": { hp: 3, statuses: [] } }),
      groundThreatOddsKey(e, teams, body(0.2), t, 2, 32, { "member-1": { hp: Number.NaN, statuses: [] } }),
      groundThreatOddsKey({ ...e, securityStrength: Number.POSITIVE_INFINITY }, teams, body(0.2), t, 2, 32),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
    // Fields a fight never reads are not in the key: the rest of the run can change without a recompute.
    const elsewhere: Expedition = { ...e, findings: [{} as never], phaseAnchorSeconds: 99 };
    expect(groundThreatOddsKey(elsewhere, teams, body(0.2), t, 2, 32)).toBe(base);
  });

  it("an input edited in place is a recompute with the new answer (no identity caching)", () => {
    const e = midExp();
    const t = task("derelictOutpost", 4);
    const before = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), t, 9).wins;
    for (const m of e.roster?.security ?? []) m.groundStats.power = 6;
    const after = groundTaskClearOdds(e, [wholeTeam(e)], body(0.2), t, 9).wins;
    expect(after).toBe(countWins(e, [wholeTeam(e)], body(0.2), t, 9, GROUND_THREAT_SAMPLES));
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("stays within its bound", () => {
    const e = midExp();
    for (let i = 0; i < GROUND_THREAT_MEMO_SIZE + 40; i += 1) groundTaskClearOdds(e, [wholeTeam(e)], body(0), task("mineralOutcrop", 1), 1000 + i, 2);
    expect(groundThreatMemoSize()).toBeLessThanOrEqual(GROUND_THREAT_MEMO_SIZE);
  });
});
