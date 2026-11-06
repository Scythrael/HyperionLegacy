// Objective affixes AF-2 (docs/plans/2026-10-14-objective-affixes-capture.md): the ground weapon RANGE attribute
// and the ROCKY OUTCROPPINGS affix on the engine. An affix-aware run dispatched before AF-2 (no affix catalog
// version on its profile) stamps, plans and resolves exactly as before (goldens captured BEFORE the change). Then
// the range classification, the evasion against long-range attacks, the cover by alignment in the fights and the
// odds, an engine run with parity, and the AF-1 re-review edge fix (a strike at the end of a short step banks the
// segment first).

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import {
  DEFAULT_MEMBER_GAMBIT,
  freshState,
  memberVariety,
  type AwayMember,
  type BodyRiskGrades,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type GameState,
  type ShipGroundTeam,
  type SnapshotMember,
} from "./model";
import { advanceExpedition, claimExpedition } from "./expedition";
import { AFFIX_CATALOG_VERSION, BASE_DIFFICULTY_TIER, generateRiskProfile, runAffixCatalog, type ExpeditionRegion } from "./riskFactors";
import { asPreCurveDispatch, asPreG2NamesDispatch, plainAwayMember, withoutAffixCatalog, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import {
  AFFIX_DEFS,
  ALERT_RESET_TEXT,
  ROCKY_OUTCROPPINGS_EVASION,
  affixPill,
  affixPool,
  affixRollWeight,
  catalogAffixes,
  longRangeCover,
  rollObjectiveAffixes,
  rollReinforcements,
  validAffixes,
  type AffixRollContext,
  type ObjectiveAffix,
} from "./affixes";
import {
  ENEMY_ROLE_RANGE,
  UNARMED_RANGE,
  attackRange,
  generateEncounter,
  memberWeaponRange,
  resolveGroundBattle,
  strikeHitChance,
  type GambitLogEvent,
  type GroundCombatant,
} from "./gambit";
import { makeRng } from "./combat/rng";
import { resolveTaskFightOnSeed, withCover, type GroundFightTeam } from "./groundFight";
import { groundTaskClearOdds, groundThreatOddsKey } from "./groundThreat";
import {
  findGroundTask,
  groundOpsAssignIdle,
  groundOpsBodyScanned,
  groundOpsEditBlockText,
  groundOpsLogText,
  initGroundTasks,
  taskCover,
} from "./groundOps";
import { forecastTasksText } from "./launchRecommendation";
// SF-1: the claimed state hashes without the run counters (a claim writes them), absent before SF-1.
import { withoutRunCounts, goldenJson } from "./firstRunsGoldens.fixture";
// WR-8 (0.14.0): every pin in this file was taken before the combat rules (combatRulesSwitch.fixture.ts), so the file
// runs with them switched off and its pins keep proving WR-8 moved nothing else here (the rules stamp new patrol
// cycles and runs; combatDescriptorGoldens.test.ts pins the combat rules themselves).
import { combatRulesOffForThisFile } from "./combatRulesSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
combatRulesOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1: Ground + Ground (or Strike + Survey) fully slotted at `rank`.
function crewed(expeditionSeed: number, kinds: "gg" | "ss" = "gg", rank = 6): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    kinds === "gg"
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [
          { kind: "strike", security: SEC.slice(), science: [], helpOthers: false },
          { kind: "survey", security: [], science: SCI.slice(), helpOthers: false },
        ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// Dispatch candidate 0, optionally on a forced region (the risk replaced before any body scans).
function dispatch(state: GameState, region?: ExpeditionRegion): { next: GameState; exp: Expedition } {
  const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(state, "ship-1", 1, "cand-0")));
  expect(res.success, String(res.reason)).toBe(true);
  let exp = res.expedition!;
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

// ===== the gate: an affix-aware run dispatched before AF-2 resolves exactly as before =====

describe("AF-2 the gate: an affix-aware run without the catalog version resolves byte-identically (goldens captured before AF-2)", () => {
  const CASES: Record<string, () => { state: GameState; region?: ExpeditionRegion }> = {
    tierOne: () => ({ state: crewed(0x0a13bd4) }),
    tierThree: () => ({ state: crewed(0x1259124), region: { tier: 3, enemyTerritory: false } }),
    tierFourEnemy: () => ({ state: crewed(0x0a13bd4), region: { tier: 4, enemyTerritory: true } }),
    strikeSurveyTierFour: () => ({ state: crewed(0x3c0ffee, "ss"), region: { tier: 4, enemyTerritory: true } }),
    tierSixWeak: () => ({ state: crewed(0x2b0b5e7, "gg", 3), region: { tier: 6, enemyTerritory: true } }),
    tierSevenEnemy: () => ({ state: crewed(0x5eed777), region: { tier: 7, enemyTerritory: true } }),
  };
  // Captured from the code BEFORE AF-2 (commit 0ffe397): five checkpoints, the phase at 2,000,000 s, the claim
  // (when the run completes).
  const GOLDEN: Record<string, string[]> = {
    tierOne: ["afde41dd", "3751a80", "7b9e7128", "16a1acb8", "97cb2db9", "activities", "unclaimed"],
    tierThree: ["36daf01f", "8ad55aca", "8ad55aca", "8ad55aca", "8ad55aca", "complete", "6fea8ae1"],
    tierFourEnemy: ["b797f1a2", "378beb64", "a7a5f021", "a7a5f021", "a7a5f021", "complete", "ca83cbb2"],
    strikeSurveyTierFour: ["8e6ef7a8", "ddcc62be", "ddcc62be", "ddcc62be", "ddcc62be", "complete", "7acaa969"],
    tierSixWeak: ["32afb8e0", "2d3420dc", "ff437ba6", "ff437ba6", "ff437ba6", "complete", "5fbbb3b4"],
    tierSevenEnemy: ["afed66d0", "5b3467c7", "561746ad", "561746ad", "561746ad", "complete", "820ca0fa"],
  };
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: checkpoints and the claim match the pre-AF-2 capture`, { timeout: 120_000 }, () => {
      const { state, region } = build();
      const d = dispatch(state, region);
      const exp = withoutAffixCatalog(d.exp);
      expect(exp.risk?.difficultyTier).toBe(1); // affix-aware
      const hashes = [T0 + 5000, T0 + 20000, T0 + 60000, T0 + 150000, T0 + 400000].map((t) => fnv(goldenJson(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, T0 + 2_000_000);
      hashes.push(done.phase);
      const claimed = done.phase === "complete" ? claimExpedition({ ...d.next, expeditions: [done] }, done.id) : null;
      hashes.push(claimed ? fnv(goldenJson(withoutRunCounts(claimed.next))) : "unclaimed");
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});

// ===== 1. the ground weapon RANGE attribute (data; no behavior on its own) =====

const piece = (varietyKey: string, slotType: "memberWeapon" | "implant" | "memberTool" = "memberWeapon") => ({
  pieceId: `piece-${varietyKey}`,
  slotType,
  varietyKey,
  points: 0,
});
const ZERO_STATS = { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 };
function sec(memberId: string, gear: ReturnType<typeof piece>[] = [], stats: Partial<typeof ZERO_STATS> = {}): SnapshotMember {
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
    gear,
    gambit: DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r })),
    effects: [],
  };
}

describe("AF-2 the ground weapon range classification [PROVISIONAL]", () => {
  it("member weapons read the catalog's range: Pulse Rifle long; Scattergun, Shock Baton, Sidearm short", () => {
    const range = (key: string) => memberVariety("memberWeapon", key)?.member.weaponRange;
    expect(range("pulseRifle")).toBe("long");
    expect(range("scattergun")).toBe("short");
    expect(range("shockBaton")).toBe("short");
    expect(range("sidearm")).toBe("short");
    expect(memberWeaponRange(sec("m", [piece("pulseRifle")]))).toBe("long");
    expect(memberWeaponRange(sec("m", [piece("scattergun")]))).toBe("short");
    expect(memberWeaponRange(sec("m", [piece("shockBaton")]))).toBe("short");
    // No weapon: unarmed, short. An implant or a tool never sets the range (the Targeting Optic is aim, not reach).
    expect(UNARMED_RANGE).toBe("short");
    expect(memberWeaponRange(sec("m"))).toBe("short");
    expect(memberWeaponRange(sec("m", [piece("targetingOptic", "implant"), piece("stunGrenade", "memberTool")]))).toBe("short");
    expect(memberWeaponRange(sec("m", [piece("targetingOptic", "implant"), piece("pulseRifle")]))).toBe("long");
  });

  it("enemy attacks by role: Strikers, Casters, Healers long; Bruisers, Swarm short; attackRange reads stamped first", () => {
    expect(ENEMY_ROLE_RANGE).toEqual({ bruiser: "short", striker: "long", healer: "long", caster: "long", swarm: "short" });
    expect(attackRange({ side: "enemy", role: "striker" })).toBe("long");
    expect(attackRange({ side: "enemy", role: "bruiser" })).toBe("short");
    expect(attackRange({ side: "team", role: "security" })).toBe("short");
    expect(attackRange({ side: "team", role: "security", range: "long" })).toBe("long");
  });

  it("the range alone changes nothing: a stamped fight with no evasion resolves exactly as an unstamped one", () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const build = (stamp: boolean) => {
        const team = [0, 1, 2].map((i) => member(`t${i}`, stamp ? "long" : undefined));
        const enemies = generateEncounter(seed, 0.3, "derelictOutpost");
        if (stamp) for (const e of enemies) e.range = attackRange(e);
        const log: GambitLogEvent[] = [];
        return { result: resolveGroundBattle(team, enemies, 1, makeRng(seed), log, seed), log };
      };
      expect(build(true)).toEqual(build(false));
    }
  });
});

// A hand-built team member (no gear effects).
function member(id: string, range?: "long" | "short", evade?: number): GroundCombatant {
  const c: GroundCombatant = {
    id,
    side: "team",
    role: "security",
    hp: 60,
    hpMax: 60,
    power: 12,
    accuracy: 0.8,
    armor: 3,
    heal: 0,
    threat: 12,
    groupTag: "security",
    statuses: [],
    downed: false,
    program: DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r })),
  };
  if (range) c.range = range;
  if (evade !== undefined) c.longRangeEvasion = evade;
  return c;
}

describe("AF-2 evasion against long-range attacks (gambit.ts strikeHitChance)", () => {
  it("only a LONG-range strike on a target with evasion is harder to land; the hit chance x (1 - evasion)", () => {
    const rifle = member("a", "long");
    const baton = member("b", "short");
    expect(strikeHitChance(rifle, {})).toBeCloseTo(0.8, 12);
    expect(strikeHitChance(rifle, { longRangeEvasion: 0.15 })).toBeCloseTo(0.8 * 0.85, 12);
    expect(strikeHitChance(baton, { longRangeEvasion: 0.15 })).toBeCloseTo(0.8, 12);
    expect(strikeHitChance(rifle, { longRangeEvasion: 0 })).toBeCloseTo(0.8, 12);
    // Suppressed first, then the cover.
    rifle.statuses = [{ id: "suppressed", magnitude: 0.4, remaining: 2 }];
    expect(strikeHitChance(rifle, { longRangeEvasion: 0.2 })).toBeCloseTo(0.8 * 0.6 * 0.8, 12);
  });

  it("cover against SHORT-range attackers only changes nothing; against long-range attackers it changes the fight", () => {
    let changed = 0;
    for (let seed = 1; seed <= 30; seed += 1) {
      const fight = (evade: number | undefined, poi: string) => {
        const team = [0, 1, 2].map((i) => member(`t${i}`, "short", evade));
        const enemies = generateEncounter(seed, 0.2, poi);
        const log: GambitLogEvent[] = [];
        return { result: resolveGroundBattle(team, enemies, 1, makeRng(seed), log, seed), log };
      };
      // Cave Network: three Swarm (short) and a possible extra Swarm: the team's cover never applies.
      expect(fight(0.21, "caveNetwork")).toEqual(fight(undefined, "caveNetwork"));
      // Derelict Outpost: Strikers (long): the cover applies.
      if (JSON.stringify(fight(0.21, "derelictOutpost")) !== JSON.stringify(fight(undefined, "derelictOutpost"))) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

// ===== 2. ROCKY OUTCROPPINGS =====

const RO = (rank: number, alignment: ObjectiveAffix["alignment"]): ObjectiveAffix => ({ id: "rockyOutcroppings", rank, alignment });
const REINF: ObjectiveAffix = { id: "reinforcing", rank: 2, alignment: "negative" };

describe("AF-2 Rocky Outcroppings: the definition and the cover by alignment", () => {
  it("the definition: all three alignments, combat objectives only, ranks I to III (15 / 18 / 21%), catalog 2", () => {
    const def = AFFIX_DEFS.rockyOutcroppings;
    expect(def.name).toBe("Rocky Outcroppings");
    expect(def.alignments).toEqual(["positive", "neutral", "negative"]);
    expect(def.appliesTo).toEqual(["combatObjective"]);
    expect(def.maxRank).toBe(3);
    expect(def.requiredFromDifficulty).toBeUndefined();
    expect(def.catalog).toBe(2);
    expect(ROCKY_OUTCROPPINGS_EVASION).toEqual([0.15, 0.18, 0.21]);
    expect(AFFIX_CATALOG_VERSION).toBe(2);
    expect(catalogAffixes(1)).toEqual(["reinforcing"]);
    expect(catalogAffixes()).toEqual(["reinforcing", "rockyOutcroppings"]);
    expect(validAffixes([RO(3, "neutral"), RO(4, "neutral"), RO(0, "positive")])).toEqual([RO(3, "neutral")]);
  });

  it("positive: your squad has the cover; neutral: both sides; negative: the enemy (user)", () => {
    expect(longRangeCover([RO(1, "positive")])).toEqual({ team: 0.15, enemy: 0 });
    expect(longRangeCover([RO(1, "neutral")])).toEqual({ team: 0.15, enemy: 0.15 });
    expect(longRangeCover([RO(1, "negative")])).toEqual({ team: 0, enemy: 0.15 });
    expect(longRangeCover([RO(2, "positive")]).team).toBeCloseTo(0.18, 12);
    expect(longRangeCover([RO(3, "negative")]).enemy).toBeCloseTo(0.21, 12);
    expect(longRangeCover([])).toEqual({ team: 0, enemy: 0 });
    expect(longRangeCover(undefined)).toEqual({ team: 0, enemy: 0 });
    expect(longRangeCover([REINF])).toEqual({ team: 0, enemy: 0 });
    expect(longRangeCover([REINF, RO(1, "positive")])).toEqual({ team: 0.15, enemy: 0 });
    // taskCover: undefined without cover (the fight and the odds are exactly as before).
    expect(taskCover({})).toBeUndefined();
    expect(taskCover({ affixes: [REINF] })).toBeUndefined();
    expect(taskCover({ affixes: [RO(1, "neutral")] })).toEqual({ team: 0.15, enemy: 0.15 });
  });

  it("the pill: green / yellow / red by alignment, the tooltip names the side and the number", () => {
    expect(affixPill(RO(1, "positive"))).toMatchObject({ label: "Rocky Outcroppings I", color: "green" });
    expect(affixPill(RO(2, "neutral"))).toMatchObject({ label: "Rocky Outcroppings II", color: "yellow" });
    expect(affixPill(RO(3, "negative"))).toMatchObject({ label: "Rocky Outcroppings III", color: "red" });
    expect(affixPill(RO(1, "positive")).tooltip).toContain("15%");
    expect(affixPill(RO(1, "positive")).tooltip).toContain("your squad");
    expect(affixPill(RO(3, "negative")).tooltip).toContain("21%");
    expect(affixPill(RO(3, "negative")).tooltip).toContain("favors the enemy");
    expect(affixPill(RO(2, "neutral")).tooltip).toContain("both sides");
    for (const text of [AFFIX_DEFS.rockyOutcroppings.help, ...(["positive", "neutral", "negative"] as const).map((a) => affixPill(RO(1, a)).tooltip)]) {
      expect(text).not.toMatch(/—|-{2}|\bfit(ting)?\b/);
    }
  });

  it("the stamping roll: combat objectives only, all three alignments, ranks gated by tier (Tier I rank I only)", () => {
    const seen = { positive: 0, neutral: 0, negative: 0 };
    const ranks = new Set<number>();
    for (let k = 0; k < 6000; k += 1) {
      const base = { seed: 0x77, bodyIndex: 0, taskIndex: k, tier: 7, difficulty: 4, difficultyTier: BASE_DIFFICULTY_TIER };
      for (const a of rollObjectiveAffixes({ ...base, combat: true })) {
        if (a.id !== "rockyOutcroppings") continue;
        seen[a.alignment] += 1;
        ranks.add(a.rank);
      }
      expect(rollObjectiveAffixes({ ...base, combat: false })).toEqual([]);
      for (const a of rollObjectiveAffixes({ ...base, tier: 1, combat: true })) expect(a.rank).toBe(1);
      // AF-1's catalog never rolls it.
      for (const a of rollObjectiveAffixes({ ...base, combat: true, catalog: 1 })) expect(a.id).toBe("reinforcing");
    }
    expect(seen.positive).toBeGreaterThan(0);
    expect(seen.neutral).toBeGreaterThan(0);
    expect(seen.negative).toBeGreaterThan(0);
    for (const r of ranks) expect(r).toBeLessThanOrEqual(3);
  });

  it("a catalog 2 run keeps every draw AF-1's layout made for Reinforcing (the required Reinforcing is the same)", () => {
    for (let k = 0; k < 500; k += 1) {
      const base = { seed: k * 31, bodyIndex: 1, taskIndex: k, tier: 6, difficulty: 5, difficultyTier: BASE_DIFFICULTY_TIER, combat: true };
      expect(rollObjectiveAffixes({ ...base })[0]).toEqual(rollObjectiveAffixes({ ...base, catalog: 1 })[0]);
    }
  });
});

describe("AF-2 the run's catalog version (the gate)", () => {
  it("every dispatch since AF-2 carries the current catalog; a profile without one reads AF-1's", () => {
    const d = dispatch(crewed(0x0a13bd4));
    expect(d.exp.risk!.affixCatalog).toBe(AFFIX_CATALOG_VERSION);
    expect(runAffixCatalog(d.exp.risk)).toBe(2);
    expect(runAffixCatalog(withoutAffixCatalog(d.exp).risk)).toBe(1);
    expect(runAffixCatalog(undefined)).toBe(1);
    expect(runAffixCatalog({ affixCatalog: 0 })).toBe(1);
  });

  it("a real Tier VII dispatch stamps from catalog 2; its pre-AF-2 twin stamps from catalog 1", { timeout: 120_000 }, () => {
    const d = dispatch(crewed(0x5eed777), { tier: 7, enemyTerritory: true });
    for (const [exp, catalog] of [
      [d.exp, 2],
      [withoutAffixCatalog(d.exp), 1],
    ] as const) {
      const done = advanceExpedition(exp, T0 + 400_000);
      let rated = 0;
      done.bodies.forEach((body, b) => {
        body.activities.forEach((task, k) => {
          if (task.difficulty === undefined) return;
          rated += 1;
          const combat = (task.fightPoints?.length ?? 0) > 0;
          const want = rollObjectiveAffixes({ seed: done.seed, bodyIndex: b, taskIndex: k, tier: 7, difficulty: task.difficulty, difficultyTier: 1, combat, catalog });
          expect(task.affixes ?? []).toEqual(want);
        });
      });
      expect(rated).toBeGreaterThan(0);
    }
  });
});

// ===== the cover in a task fight and in the odds =====

function fightExp(security: SnapshotMember[], over: Partial<Expedition> = {}): Expedition {
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
    bodies: [],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 424242,
    securityStrength: 20,
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
const fightBody = (hazard: number): Pick<ExpeditionBody, "hazard" | "risk"> => ({ hazard });
function fightTask(poiId: string, points: number): ExpeditionActivity {
  const fightPoints = Array.from({ length: points }, (_, k) => (k + 1) / (points + 1));
  return { id: "act-1", bodyId: "body-1", poiId, done: false, fightPoints, progress: 0, pointsCleared: 0, fightCount: 0 };
}
const whole = (e: Expedition): GroundFightTeam[] => [{ securityIds: (e.roster?.security ?? []).map((m) => m.memberId), downedThisTask: [], securityShare: 1 }];
const rifles = () => fightExp([sec("member-1", [piece("pulseRifle")]), sec("member-2", [piece("pulseRifle")]), sec("member-3", [piece("pulseRifle")])]);
const batons = () => fightExp([sec("member-1", [piece("shockBaton")]), sec("member-2", [piece("shockBaton")]), sec("member-3", [piece("shockBaton")])]);

describe("AF-2 the cover in a task fight (groundFight.ts withCover)", () => {
  it("withCover stamps each member's weapon range and each covered side's evasion; no cover leaves both lists untouched", () => {
    const e = fightExp([sec("member-1", [piece("pulseRifle")]), sec("member-2", [piece("scattergun")]), sec("member-3")]);
    const team = () => [0, 1, 2].map((i) => ({ ...member(`x-${i}`), memberId: `member-${i + 1}` }));
    const enemies = () => generateEncounter(5, 0.2, "subterraneanCivilization");
    const t0 = team();
    const e0 = enemies();
    withCover(t0, e0, undefined, e.roster!.security);
    withCover(t0, e0, { team: 0, enemy: 0 }, e.roster!.security);
    expect(t0).toEqual(team());
    expect(e0).toEqual(enemies());
    const t1 = team();
    const e1 = enemies();
    withCover(t1, e1, longRangeCover([RO(1, "neutral")]), e.roster!.security);
    expect(t1.map((c) => c.range)).toEqual(["long", "short", "short"]);
    expect(t1.every((c) => c.longRangeEvasion === 0.15)).toBe(true);
    expect(e1.map((c) => c.range)).toEqual(e1.map((c) => ENEMY_ROLE_RANGE[c.role as keyof typeof ENEMY_ROLE_RANGE]));
    expect(e1.every((c) => c.longRangeEvasion === 0.15)).toBe(true);
    const t2 = team();
    const e2 = enemies();
    withCover(t2, e2, longRangeCover([RO(2, "positive")]), e.roster!.security);
    expect(t2.every((c) => c.longRangeEvasion === 0.18)).toBe(true);
    expect(e2.every((c) => c.longRangeEvasion === undefined)).toBe(true);
    const t3 = team();
    const e3 = enemies();
    withCover(t3, e3, longRangeCover([RO(3, "negative")]), e.roster!.security);
    expect(t3.every((c) => c.longRangeEvasion === undefined)).toBe(true);
    expect(e3.every((c) => c.longRangeEvasion === 0.21)).toBe(true);
  });

  it("the right side per alignment: negative cover hurts a rifle squad but never a baton squad; positive never helps vs a Swarm", () => {
    let rifleChanged = 0;
    for (let seed = 1; seed <= 25; seed += 1) {
      const run = (e: Expedition, poi: string, cover?: ObjectiveAffix[]) =>
        resolveTaskFightOnSeed(e, whole(e), fightBody(0.2), fightTask(poi, 1), seed, undefined, undefined, 0, cover ? longRangeCover(cover) : undefined);
      // Negative: the GUARD has the cover; batons are short range, so a baton squad fights exactly as without it.
      expect(run(batons(), "caveNetwork", [RO(3, "negative")])).toEqual(run(batons(), "caveNetwork"));
      // Positive: the SQUAD has the cover; a Swarm's claws are short range, so nothing changes.
      expect(run(rifles(), "caveNetwork", [RO(3, "positive")])).toEqual(run(rifles(), "caveNetwork"));
      // An undefined cover and a zero cover are the fight as before.
      expect(run(rifles(), "derelictOutpost", [])).toEqual(run(rifles(), "derelictOutpost"));
      if (JSON.stringify(run(rifles(), "caveNetwork", [RO(3, "negative")])) !== JSON.stringify(run(rifles(), "caveNetwork"))) rifleChanged += 1;
    }
    expect(rifleChanged).toBeGreaterThan(0);
  });

  it("the odds read the cover: positive >= none >= negative for a rifle squad against Strikers; the memo key adds it only when present", () => {
    const e = { ...rifles(), securityStrength: 6 };
    const t = fightTask("derelictOutpost", 2);
    const odds = (cover?: ObjectiveAffix[]) => groundTaskClearOdds(e, whole(e), fightBody(0.3), t, 0, 160, undefined, 0, cover ? longRangeCover(cover) : undefined).wins;
    const none = odds();
    const pos = odds([RO(3, "positive")]);
    const neg = odds([RO(3, "negative")]);
    expect(pos).toBeGreaterThan(none);
    expect(neg).toBeLessThan(none);
    const key = (cover?: ObjectiveAffix[]) => groundThreatOddsKey(e, whole(e), fightBody(0.3), t, 0, 32, undefined, 0, cover ? longRangeCover(cover) : undefined);
    expect(key([])).toBe(key());
    expect(key([REINF])).toBe(key());
    expect(key([RO(1, "positive")])).not.toBe(key());
    expect(key([RO(1, "positive")])).not.toBe(key([RO(1, "negative")]));
    expect(key([RO(1, "neutral")])).not.toBe(key([RO(2, "neutral")]));
  });
});

// ===== the engine: a run with Rocky Outcroppings =====

const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

// One Ground team slotted (3 / 3) at `rank` and an empty pair: one team deploys.
function oneTeam(rank = 1): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: rank as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0 - 50_000,
    awayMembers: [...SEC.slice(0, 3).map((id) => m(id, "security")), ...SCI.slice(0, 3).map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

interface Setup {
  pois: string[];
  risk: BodyRiskGrades;
  rank?: number;
  hazard?: number;
  securityStrength?: number;
  seed?: number;
  after?: (e: Expedition) => void; // edit the stamped tasks (and the frozen roster) before the plan
}

// A dispatched run turned into an affix-aware run whose window opened at T0 with body 0 (carrying `risk`) just
// scanned: its tasks stamped through the real path, then planned, then the teams pick.
function affixRun(setup: Setup): Expedition {
  const res = asPreCurveDispatch(asPreG2NamesDispatch(dispatchPastPropulsion(oneTeam(setup.rank ?? 1), "ship-1", 1, "cand-0")));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = res.expedition;
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: setup.hazard ?? 0.1,
    scanned: true,
    discoveries: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: setup.pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...setup.risk },
  };
  const exp: Expedition = structuredClone({
    ...d,
    seed: setup.seed ?? d.seed,
    ...(setup.securityStrength !== undefined ? { securityStrength: setup.securityStrength } : {}),
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: setup.risk.combat, fauna: setup.risk.fauna, flora: setup.risk.flora }, difficultyTier: 1, affixCatalog: 2 },
  });
  initGroundTasks(exp, 0);
  setup.after?.(exp);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

// Advance in `step` second chunks from `from` to `to` (inclusive of `to`).
function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

const withAffixes = (affixes: ObjectiveAffix[]) => (e: Expedition) => {
  for (const task of e.bodies[0].activities) {
    if (affixes.length > 0) task.affixes = affixes.map((a) => ({ ...a }));
    else delete task.affixes;
  }
};
const armRifles = (e: Expedition) => {
  for (const m of e.roster!.security) m.gear = [piece("pulseRifle")];
};

describe("AF-2 a run with Rocky Outcroppings (engine)", () => {
  it("the objective's fights carry its cover: the same run with and without it differs, without it is the plain run", { timeout: 120_000 }, () => {
    const setup: Setup = { pois: ["derelictOutpost", "enemyColony"], risk: { ...CALM, combat: 3 }, rank: 3, securityStrength: 8 };
    const plain = affixRun({ ...setup, after: withAffixes([]) });
    const covered = affixRun({ ...setup, after: withAffixes([RO(3, "positive")]) });
    const end = T0 + 6 * 3600;
    const a = advanceExpedition(plain, end);
    const b = advanceExpedition(covered, end);
    const fights = (e: Expedition) => e.groundOps!.history.filter((r) => r.outcome !== undefined);
    expect(fights(a).length).toBeGreaterThan(0);
    const summary = (e: Expedition) => JSON.stringify(fights(e).map((r) => [r.taskId, r.outcome, r.startedAt, r.endedAt]));
    expect(summary(b)).not.toBe(summary(a));
    // The cover is the only difference: the covered run's tasks carry it, the plain run's carry nothing.
    expect(taskCover(b.bodies[0].activities[0])).toEqual({ team: 0.21, enemy: 0 });
    expect(taskCover(a.bodies[0].activities[0])).toBeUndefined();
  });

  it("parity: one call == 997 s chunks == 1 s chunks with negative cover on a rifle squad and Reinforcing", { timeout: 300_000 }, () => {
    // A first strike early on the bar (before the first fight point), so the crew meets it.
    const reinforcing: ObjectiveAffix = { id: "reinforcing", rank: 3, alignment: "negative" };
    let seed = 1;
    while ((rollReinforcements(seed, 0, 0, [reinforcing])[0] ?? 1) > 0.2) seed += 1;
    const exp = affixRun({
      seed,
      pois: ["derelictOutpost", "crashedShip"],
      risk: { ...CALM, combat: 3 },
      rank: 2,
      securityStrength: 6,
      after: (e) => {
        armRifles(e);
        withAffixes([reinforcing, RO(2, "negative")])(e);
        for (const task of e.bodies[0].activities) task.difficultyScore = 6;
      },
    });
    const end = T0 + 3 * 3600;
    const one = advanceExpedition(exp, end);
    // The window holds what the test is about: fights under the cover, a reinforcement among them, and a loss.
    expect(one.groundOps!.history.some((r) => r.outcome !== undefined)).toBe(true);
    expect(one.groundOps!.history.some((r) => r.reinforcement)).toBe(true);
    expect(one.groundOps!.history.some((r) => r.outcome === "loss")).toBe(true);
    expect(chunked(exp, T0, end, 997)).toEqual(one);
    expect(chunked(exp, T0, end, 1)).toEqual(one);
  });
});

// ===== 3. the AF-1 re-review edge fix: a strike at the end of a step under 2 s banks the segment FIRST =====

describe("AF-1 re-review: a reinforcement striking at the END of a short step banks the segment first", () => {
  it("the working crew banks the finished segment, then fights the reinforcements; the credit stays with it", { timeout: 120_000 }, () => {
    const exp = affixRun({ pois: ["derelictOutpost"], risk: { ...CALM, combat: 2 }, after: withAffixes([]) });
    // Mid-drop: put the task a hair short of its first fight point and a strike just before the point.
    const mid = advanceExpedition(exp, T0 + 30);
    const lead = mid.groundOps!.teams.find((t) => t.taskId !== undefined)!;
    expect(lead.step).toBe("deploy");
    const ref = findGroundTask(mid, lead.taskId as string)!;
    const point = ref.task.fightPoints![0];
    ref.task.progress = point - 1e-9;
    lead.reinforcementsAt = [point - 5e-10];
    const landed = lead.stepEndsAt as number;
    // The step is under 2 s (1 s): the strike lands at its end, at the point itself.
    const after = advanceExpedition(mid, landed + 1);
    const task = findGroundTask(after, ref.task.id)!.task;
    const team = after.groundOps!.teams.find((t) => t.index === lead.index)!;
    expect(task.progress).toBe(point);
    expect(task.segmentsBanked).toBe(1);
    expect(task.segmentBankers![0]).toEqual([lead.index]);
    expect(team.step).toBe("fight");
    expect(team.pendingFight?.reinforcement).toBe(true);
    expect(task.pointsCleared ?? 0).toBe(0);
    // Played out: the segment's bankers stay the working crew's, whoever finishes the objective.
    const done = advanceExpedition(after, T0 + 12 * 3600);
    expect(findGroundTask(done, ref.task.id)!.task.segmentBankers![0]).toEqual([lead.index]);
  });
});

// ===== AF-2 follow-up: per-context affix weights (user 2026-10-14, section 7) =====

describe("AF-2 follow-up: affix roll weights can vary by context (one shared rolled slot kept)", () => {
  it("affixRollWeight: the flat rollWeight by default; a weightFor hook decides when present; non-positive reads 0", () => {
    const ctx = { tier: 3 as const, difficulty: 4, difficultyTier: 1, target: "combatObjective" as const };
    expect(affixRollWeight(AFFIX_DEFS.reinforcing, ctx)).toBe(100);
    expect(affixRollWeight(AFFIX_DEFS.rockyOutcroppings, ctx)).toBe(100);
    expect(affixRollWeight({ rollWeight: 7, weightFor: (c) => c.tier * 10 }, ctx)).toBe(30);
    expect(affixRollWeight({ rollWeight: 7, weightFor: () => -1 }, ctx)).toBe(0);
    expect(affixRollWeight({ rollWeight: 7, weightFor: () => Number.NaN }, ctx)).toBe(0);
    expect(affixRollWeight({ rollWeight: 7, weightFor: () => 0.5 }, ctx)).toBe(0); // a fraction below 1 never rolls
    expect(affixRollWeight({ rollWeight: 7, weightFor: () => 12.9 }, ctx)).toBe(12);
    expect(AFFIX_DEFS.reinforcing.weightFor).toBeUndefined();
    expect(AFFIX_DEFS.rockyOutcroppings.weightFor).toBeUndefined();
  });

  it("the pool reads the hook with the tier, difficulty, difficulty tier and planet type; without one the planet type changes nothing", () => {
    for (const tier of [1, 4, 7]) {
      for (const d of [1, 3, 5]) {
        expect(affixPool(tier, d, 1, "combatObjective", 2, "volcanic")).toEqual(affixPool(tier, d, 1, "combatObjective", 2));
      }
    }
    const def = AFFIX_DEFS.rockyOutcroppings as { weightFor?: (c: AffixRollContext) => number };
    const seen: AffixRollContext[] = [];
    def.weightFor = (c) => {
      seen.push(c);
      return c.planetType === "barren" ? 300 : c.planetType === "ocean" ? 0 : 100;
    };
    try {
      expect(affixPool(3, 4, 1, "combatObjective", 2, "barren").entries).toEqual([
        { id: "reinforcing", weight: 100 },
        { id: "rockyOutcroppings", weight: 300 },
      ]);
      expect(affixPool(3, 4, 1, "combatObjective", 2, "ocean").entries).toEqual([{ id: "reinforcing", weight: 100 }]);
      expect(seen[0]).toEqual({ tier: 3, difficulty: 4, difficultyTier: 1, planetType: "barren", target: "combatObjective" });
      // The stamping roll passes the body's planet type through.
      let outcroppings = 0;
      for (let k = 0; k < 4000; k += 1) {
        const base = { seed: 0x91, bodyIndex: 0, taskIndex: k, tier: 7, difficulty: 4, difficultyTier: 1, combat: true };
        for (const a of rollObjectiveAffixes({ ...base, planetType: "ocean" })) expect(a.id).toBe("reinforcing");
        outcroppings += rollObjectiveAffixes({ ...base, planetType: "barren" }).filter((a) => a.id === "rockyOutcroppings").length;
      }
      expect(outcroppings).toBeGreaterThan(0);
    } finally {
      delete def.weightFor;
    }
  });
});

// ===== AF-2 follow-up: the engine's player-facing text says "objective" (user 2026-10-14) =====

describe("AF-2 follow-up: engine player-facing text says objective, never task", () => {
  const TASK = /\btasks?\b/i;
  it("every edit refusal, the log fallback and the launch texts", () => {
    const reasons = [
      "noExpedition",
      "notGroundOps",
      "runFinished",
      "noSuchTask",
      "taskDone",
      "taskSkipped",
      "notSkipped",
      "noSuchTeam",
      "noSuchBody",
      "noTasks",
      "notInQueue",
      "notEnoughSquads",
      "crewDoesNotCover",
      "noChange",
    ] as const;
    for (const r of reasons) expect(groundOpsEditBlockText(r)).not.toMatch(TASK);
    expect(groundOpsEditBlockText("noSuchTask")).toBe("No such objective");
    expect(groundOpsEditBlockText("noTasks")).toBe("No queued objectives on that body to plan");
    // The log line's fallback name when the objective cannot be found.
    expect(groundOpsLogText({ bodies: [] }, { at: 0, kind: "alertReset", taskId: "nowhere" })).toBe(`An objective: ${ALERT_RESET_TEXT}`);
    expect(forecastTasksText({ tasks: 3, byDifficulty: [1, 2, 0, 0, 0] })).toBe("3 objectives: 1 Simple, 2 Standard");
    expect(forecastTasksText({ tasks: 1, byDifficulty: [1, 0, 0, 0, 0] })).toBe("1 objective: 1 Simple");
    expect(forecastTasksText({ tasks: 0, byDifficulty: [0, 0, 0, 0, 0] })).toBe("No ground objectives expected");
  });
});
