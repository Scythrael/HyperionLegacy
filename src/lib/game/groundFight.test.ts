// Ground Operations (GO-5): ONE task fight, pure. A private keyed stream per (task flat index, fight number),
// the Security squad of the team set (minus the task's downed), the end-of-fight conditions the bay reads, and
// CARRY DAMAGE (user Q5): survivors keep their HP and their persisting conditions from fight to fight of a task.

import { describe, it, expect } from "vitest";
import { DEFAULT_MEMBER_GAMBIT, type Expedition, type ExpeditionActivity, type ExpeditionBody, type SnapshotMember } from "./model";
import { makeRng } from "./combat/rng";
import { COMBAT_SALT, NEURAL_BACKUP_SALT, MAX_ROUNDS, type GambitLogEvent, type GroundCombatant } from "./gambit";
import { GROUND_CONDITIONS } from "./medicalBay";
import {
  GROUND_FIGHT_SALT,
  GROUND_ROUND_SECONDS,
  isCarriedStatus,
  memberEndConditions,
  resolveTaskFight,
  taskFightSeconds,
  taskFightSeed,
  taskFightTeam,
  type GroundFightRecord,
  type GroundFightTeam,
  type GroundMemberCarry,
} from "./groundFight";

// ===== Fixtures =====

const ZERO_STATS = { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 };

function sec(memberId: string, over: Partial<SnapshotMember> = {}, stats: Partial<typeof ZERO_STATS> = {}): SnapshotMember {
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
    ...over,
  };
}

function body(hazard: number): ExpeditionBody {
  return { id: "body-1", planetType: "toxic", scanTotal: 100, scanProgress: 0, hazard, scanned: true, discoveries: [], activities: [] };
}

function task(poiId: string, over: Partial<ExpeditionActivity> = {}): ExpeditionActivity {
  return { id: "act-1", bodyId: "body-1", poiId, done: false, fightPoints: [0.5], progress: 0.5, pointsCleared: 0, fightCount: 0, ...over };
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

// One team holding every Security member, the whole crew layer.
function wholeTeam(e: Expedition, downed: string[] = []): GroundFightTeam {
  return { securityIds: (e.roster?.security ?? []).map((m) => m.memberId), downedThisTask: downed, securityShare: 1 };
}

const STRONG = { hp: 3, power: 3, armor: 2 };
const strongExp = (over: Partial<Expedition> = {}) =>
  exp([sec("member-1", {}, STRONG), sec("member-2", {}, STRONG), sec("member-3", {}, STRONG)], { securityStrength: 40, ...over });
const weakExp = (over: Partial<Expedition> = {}) => exp([sec("member-1"), sec("member-2")], over);

const HARD = task("subterraneanCivilization");
const EASY = task("mineralOutcrop");

function fight(e: Expedition, t: ExpeditionActivity, b = body(0.2), teams = [wholeTeam(e)], carried?: Record<string, GroundMemberCarry>, log?: GambitLogEvent[]) {
  return resolveTaskFight(e, teams, b, t, 7, carried, log);
}

const strip = (r: GroundFightRecord) => ({ ...r, fightNumber: 0 });

// ===== The stream =====

describe("the fight's private keyed stream (GO-5)", () => {
  it("is seed ^ GROUND_FIGHT_SALT ^ the flat index ^ the fight number, never the legacy COMBAT_SALT battle", () => {
    const e = strongExp();
    expect(GROUND_FIGHT_SALT).toBe(0x4d2a7e1b);
    const want = (e.seed ^ GROUND_FIGHT_SALT ^ Math.imul(7 + 1, 0x9e3779b9) ^ Math.imul(2 + 1, 0x85ebca6b)) >>> 0;
    expect(taskFightSeed(e, 7, 2)).toBe(want);
    const legacy = (e.seed ^ COMBAT_SALT ^ Math.imul(7 + 1, 0x9e3779b9) ^ Math.imul(2 + 1, 0x85ebca6b)) >>> 0;
    expect(taskFightSeed(e, 7, 2)).not.toBe(legacy);
    // Every (flat index, fight number) pair keys its own stream.
    const seen = new Set<number>();
    for (let i = 0; i < 6; i += 1) for (let f = 0; f < 6; f += 1) seen.add(taskFightSeed(e, i, f));
    expect(seen.size).toBe(36);
  });

  it("same inputs give a deep-equal record, and the inputs are never mutated", () => {
    const e = strongExp();
    const t = task("ancientRuins");
    const teams = [wholeTeam(e)];
    const before = JSON.parse(JSON.stringify({ e, t, teams }));
    const a = fight(e, t, body(0.4), teams);
    const b = fight(e, t, body(0.4), teams);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify({ e, t, teams }))).toEqual(before);
  });

  it("records the point and the fight number it was keyed by", () => {
    const e = strongExp();
    const r = fight(e, task("crashedShip", { pointsCleared: 2, fightCount: 5, fightPoints: [0.25, 0.5, 0.75] }));
    expect(r.pointIndex).toBe(2);
    expect(r.fightNumber).toBe(5);
    // Absent counters read 0 (a freshly stamped task).
    const fresh = fight(e, { id: "act-1", bodyId: "body-1", poiId: "crashedShip", done: false });
    expect(fresh.pointIndex).toBe(0);
    expect(fresh.fightNumber).toBe(0);
  });

  it("a different fightCount is a fresh encounter (a different enemy set or course)", () => {
    const e = strongExp();
    const logs: string[] = [];
    for (let f = 0; f < 4; f += 1) {
      const log: GambitLogEvent[] = [];
      fight(e, task("derelictOutpost", { fightCount: f }), body(0.5), [wholeTeam(e)], undefined, log);
      logs.push(JSON.stringify(log));
    }
    expect(new Set(logs).size).toBe(4);
  });
});

// ===== Who fights =====

describe("the squad that fights (GO-5)", () => {
  it("a member in downedThisTask never appears, and the others keep their deploy-index ids and numbers", () => {
    const e = strongExp();
    const full = taskFightTeam(e, [wholeTeam(e)], EASY);
    const team = taskFightTeam(e, [wholeTeam(e, ["member-2"])], EASY);
    expect(team.map((c) => c.memberId)).toEqual(["member-1", "member-3"]);
    expect(team.map((c) => c.id)).toEqual([full[0].id, full[2].id]);
    expect(team[1]).toEqual(full[2]); // same HP / power: a squadmate being out changes no member's numbers
    const log: GambitLogEvent[] = [];
    const r = fight(e, HARD, body(0.6), [wholeTeam(e, ["member-2"])], undefined, log);
    expect(log.length).toBeGreaterThan(0);
    for (const ev of log) {
      expect(ev.memberId).not.toBe("member-2");
      expect(ev.targetMemberId).not.toBe("member-2");
    }
    expect(r.downedMemberIds).not.toContain("member-2");
    expect(r.memberConditions["member-2"]).toBeUndefined();
    expect(r.memberEnd["member-2"]).toBeUndefined();
  });

  it("the team set's Security members fight together: two half-share teams equal one whole team", () => {
    const e = strongExp();
    const one = fight(e, HARD, body(0.5), [wholeTeam(e)]);
    const two = fight(e, HARD, body(0.5), [
      { securityIds: ["member-1", "member-2"], securityShare: 0.5 },
      { securityIds: ["member-3"], securityShare: 0.5 },
    ]);
    expect(two).toEqual(one);
    // A repeat id fights once; an unknown id is skipped.
    const dup = taskFightTeam(e, [{ securityIds: ["member-1", "member-1", "ghost"], securityShare: 1 }], EASY);
    expect(dup.map((c) => c.memberId)).toEqual(["member-1"]);
  });

  it("the squad's crew layer is the run's Security strength times the summed share", () => {
    const e = strongExp();
    const whole = taskFightTeam(e, [{ securityIds: ["member-1"], securityShare: 1 }], EASY)[0];
    const half = taskFightTeam(e, [{ securityIds: ["member-1"], securityShare: 0.5 }], EASY)[0];
    const none = taskFightTeam(e, [{ securityIds: ["member-1"], securityShare: NaN }], EASY)[0];
    expect(half.hpMax).toBeLessThan(whole.hpMax);
    expect(none.hpMax).toBe(taskFightTeam({ ...e, securityStrength: 0 }, [{ securityIds: ["member-1"], securityShare: 1 }], EASY)[0].hpMax);
  });

  it("with nobody left to field there is no battle: a loss of 0 rounds, nothing recorded", () => {
    const e = strongExp();
    const r = fight(e, HARD, body(0.5), [wholeTeam(e, ["member-1", "member-2", "member-3"])]);
    expect(r).toEqual({
      pointIndex: 0,
      fightNumber: 0,
      outcome: "loss",
      rounds: 0,
      downedMemberIds: [],
      memberConditions: {},
      memberEnd: {},
    });
    expect(taskFightSeconds(r)).toBe(1);
  });
});

// ===== The end of the fight =====

describe("end-of-fight conditions (GO-5)", () => {
  it("a wiped squad records every member downed (and hurt), with no survivor carry", () => {
    const e = weakExp();
    const r = fight(e, HARD, body(1));
    expect(r.outcome).toBe("loss");
    expect(r.downedMemberIds).toEqual(["member-1", "member-2"]);
    for (const id of ["member-1", "member-2"]) {
      expect(r.memberConditions[id]).toContain("downed");
      expect(r.memberConditions[id]).toContain("health");
    }
    expect(r.memberEnd).toEqual({});
  });

  it("a survivor below max HP gets 'health'; a survivor at full HP gets nothing", () => {
    const e = exp([sec("member-1", {}, { hp: 1, power: 2, armor: 1 }), sec("member-2", {}, { hp: 1, power: 2, armor: 1 })], { securityStrength: 20 });
    let hurt = 0;
    for (let f = 0; f < 12; f += 1) {
      const r = fight(e, task("ancientRuins", { fightCount: f }), body(0.3));
      for (const [id, end] of Object.entries(r.memberEnd)) {
        const conds = r.memberConditions[id] ?? [];
        if (end.hp < end.hpMax) {
          hurt += 1;
          expect(conds).toContain("health");
        } else {
          expect(conds).not.toContain("health");
        }
        expect(conds).not.toContain("downed");
      }
    }
    expect(hurt).toBeGreaterThan(0);
  });

  it("reads only bay conditions off a combatant: poison and bleed stay, weakened / stun / buffs end with the battle", () => {
    const c: GroundCombatant = {
      id: "x-sec-0",
      side: "team",
      role: "security",
      hp: 50,
      hpMax: 50,
      power: 10,
      accuracy: 0.9,
      armor: 3,
      heal: 0,
      threat: 10,
      groupTag: "security",
      statuses: [
        { id: "weakened", magnitude: 0.35, remaining: 2 },
        { id: "poison", magnitude: 5, remaining: 3 },
        { id: "stun", magnitude: 1, remaining: 1 },
        { id: "shielded", magnitude: 0.4, remaining: 1 },
        { id: "bleed", magnitude: 7, remaining: 1 },
      ],
      downed: false,
      memberId: "member-1",
    };
    expect(memberEndConditions(c)).toEqual(["poison", "bleed"]);
    expect(memberEndConditions({ ...c, hp: 20 })).toEqual(["health", "poison", "bleed"]);
    expect(memberEndConditions({ ...c, hp: 0, downed: true, statuses: [] })).toEqual(["health", "downed"]);
    // Every id it can return is a bay condition.
    for (const id of ["poison", "bleed"]) expect(isCarriedStatus(id)).toBe(true);
    for (const id of ["weakened", "stun", "suppressed", "corroded", "fear", "shielded", "inspired", "health", "downed", "toString"]) {
      expect(isCarriedStatus(id), id).toBe(false);
    }
    for (const id of memberEndConditions({ ...c, hp: 0, downed: true })) expect(Object.keys(GROUND_CONDITIONS)).toContain(id);
  });

  it("rounds are the rounds fought, and the fight step lasts rounds * GROUND_ROUND_SECONDS", () => {
    const e = strongExp();
    const r = fight(e, EASY, body(0));
    expect(r.rounds).toBeGreaterThanOrEqual(1);
    expect(r.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(GROUND_ROUND_SECONDS).toBe(6);
    expect(taskFightSeconds(r)).toBe(r.rounds * GROUND_ROUND_SECONDS);
    // The rounds fought match the 1-based round of the last logged action.
    const log: GambitLogEvent[] = [];
    fight(e, EASY, body(0), [wholeTeam(e)], undefined, log);
    expect(Math.max(...log.map((ev) => ev.round))).toBe(r.rounds);
  });

  it("the log sink does not change the record", () => {
    for (const e of [strongExp(), weakExp()]) {
      for (const t of [EASY, HARD]) {
        const log: GambitLogEvent[] = [];
        expect(fight(e, t, body(0.5), [wholeTeam(e)], undefined, log)).toEqual(fight(e, t, body(0.5)));
        expect(log.length).toBeGreaterThan(0);
      }
    }
  });

  it("the museum hazard resist softens the guard (it is the body's danger that changes the fight)", () => {
    const e = weakExp();
    const raw = fight(e, task("geothermalChamber"), body(1));
    const resisted = fight({ ...e, hazardResist: 5 }, task("geothermalChamber"), body(1));
    expect(resisted).not.toEqual(raw);
  });
});

// ===== Neural Backup =====

describe("Neural Backup in a task fight (GO-5)", () => {
  const wearer = sec("member-1", { effects: [{ kind: "revive", chance: 0.5, hpFraction: 0.3, points: 10 }] });

  it("rolls on its own stream off the fight's seed; the record is identical with and without a log", () => {
    let rolled = 0;
    for (let f = 0; f < 10; f += 1) {
      const e = exp([wearer, sec("member-2")]);
      const t = task("subterraneanCivilization", { fightCount: f });
      const r = fight(e, t, body(1));
      const log: GambitLogEvent[] = [];
      expect(fight(e, t, body(1), [wholeTeam(e)], undefined, log)).toEqual(r);
      if (!r.neuralBackup) continue;
      rolled += 1;
      const want = makeRng((taskFightSeed(e, 7, f) ^ NEURAL_BACKUP_SALT) >>> 0).chance(500, 1000);
      expect(r.neuralBackup.revived).toBe(want);
      expect(["member-1", "member-2"]).toContain(r.neuralBackup.memberId);
      expect(log.some((ev) => ev.action === "neuralBackup")).toBe(true);
    }
    expect(rolled).toBeGreaterThan(0);
  });
});

// ===== Carry damage (user Q5) =====

describe("carry damage between the fights of one task (user Q5)", () => {
  it("a carried member starts at the carried HP (clamped to [1, max]) with only the persisting conditions", () => {
    const e = strongExp();
    const full = taskFightTeam(e, [wholeTeam(e)], EASY);
    const max = full[0].hpMax;
    const carried: Record<string, GroundMemberCarry> = {
      "member-1": {
        hp: 17,
        statuses: [
          { id: "poison", magnitude: 5, remaining: 3 },
          { id: "weakened", magnitude: 0.35, remaining: 2 },
          { id: "stun", magnitude: 1, remaining: 1 },
          { id: "poison", magnitude: 9, remaining: 9 },
        ],
      },
      "member-2": { hp: max * 10, statuses: [] },
      "member-3": { hp: 0, statuses: [{ id: "bleed", magnitude: 7, remaining: 0 }] },
      ghost: { hp: 1, statuses: [] },
    };
    const team = taskFightTeam(e, [wholeTeam(e)], EASY, carried);
    expect(team[0].hp).toBe(17);
    expect(team[0].hpMax).toBe(max);
    expect(team[0].statuses).toEqual([{ id: "poison", magnitude: 5, remaining: 3 }]);
    expect(team[0].statuses[0]).not.toBe(carried["member-1"].statuses[0]); // a fresh copy
    expect(team[1].hp).toBe(max);
    expect(team[2].hp).toBe(1); // a standing member is never fielded at 0
    expect(team[2].statuses).toEqual([]); // an expired status does not come back
    // A non-finite carried HP is ignored (full HP).
    expect(taskFightTeam(e, [wholeTeam(e)], EASY, { "member-1": { hp: NaN, statuses: [] } })[0].hp).toBe(max);
  });

  it("no carried state, an empty map and a full-HP carry are all the full-HP fight", () => {
    const e = strongExp();
    const fresh = fight(e, HARD, body(0.5));
    expect(fight(e, HARD, body(0.5), [wholeTeam(e)], {})).toEqual(fresh);
    const fullHp: Record<string, GroundMemberCarry> = {};
    for (const c of taskFightTeam(e, [wholeTeam(e)], HARD)) fullHp[c.memberId as string] = { hp: c.hpMax, statuses: [] };
    expect(fight(e, HARD, body(0.5), [wholeTeam(e)], fullHp)).toEqual(fresh);
  });

  it("the second fight with the first fight's carried HP starts lower and resolves differently from a fresh one", () => {
    const e = strongExp();
    const first = fight(e, task("buriedVault", { fightCount: 0 }), body(0.7));
    expect(first.outcome).toBe("win");
    const hurt = Object.values(first.memberEnd).filter((m) => m.hp < m.hpMax);
    expect(hurt.length).toBeGreaterThan(0);
    const second = task("buriedVault", { fightCount: 1, pointsCleared: 1 });
    const team = taskFightTeam(e, [wholeTeam(e, first.downedMemberIds)], second, first.memberEnd);
    for (const c of team) expect(c.hp).toBe(first.memberEnd[c.memberId as string].hp);
    const fresh = fight(e, second, body(0.7), [wholeTeam(e, first.downedMemberIds)]);
    const carriedFight = fight(e, second, body(0.7), [wholeTeam(e, first.downedMemberIds)], first.memberEnd);
    expect(carriedFight).not.toEqual(fresh);
    const total = (r: GroundFightRecord) => Object.values(r.memberEnd).reduce((s, m) => s + m.hp, 0);
    expect(total(carriedFight)).toBeLessThan(total(fresh));
  });

  it("a deep enough carry turns a win into a wipe", () => {
    const e = strongExp();
    const fresh = fight(e, task("derelictOutpost"), body(0.5));
    expect(fresh.outcome).toBe("win");
    const battered: Record<string, GroundMemberCarry> = {};
    for (const id of ["member-1", "member-2", "member-3"]) battered[id] = { hp: 1, statuses: [] };
    const r = fight(e, task("derelictOutpost"), body(0.5), [wholeTeam(e)], battered);
    expect(r.outcome).toBe("loss");
  });

  it("carried poison persists into the next fight: it keeps ticking, and it is recorded again at the end", () => {
    const e = strongExp();
    const carried: Record<string, GroundMemberCarry> = { "member-1": { hp: 60, statuses: [{ id: "poison", magnitude: 5, remaining: 30 }] } };
    const r = fight(e, EASY, body(0), [wholeTeam(e)], carried);
    expect(r.outcome).toBe("win");
    expect(r.memberConditions["member-1"]).toContain("poison");
    expect(r.memberConditions["member-1"]).toContain("health");
    // It ticked once per round fought, from where it left off.
    expect(r.memberEnd["member-1"].statuses).toEqual([{ id: "poison", magnitude: 5, remaining: 30 - r.rounds }]);
    // And it hurt: the same fight without the poison ends with member-1 higher.
    const clean = fight(e, EASY, body(0), [wholeTeam(e)], { "member-1": { hp: 60, statuses: [] } });
    expect(r.memberEnd["member-1"].hp).toBeLessThan(clean.memberEnd["member-1"].hp);
    // A combat-only status carried in is dropped at the start, so it is never recorded.
    const w = fight(e, EASY, body(0), [wholeTeam(e)], { "member-1": { hp: 60, statuses: [{ id: "weakened", magnitude: 0.35, remaining: 30 }] } });
    expect(w.memberConditions["member-1"] ?? []).not.toContain("weakened");
    expect(w).toEqual(clean);
  });

  it("the end state lists every standing member with HP, max HP and the persisting statuses only", () => {
    const e = strongExp();
    const r = fight(e, HARD, body(0.5));
    const fielded = ["member-1", "member-2", "member-3"];
    for (const id of fielded) {
      if (r.downedMemberIds.includes(id)) {
        expect(r.memberEnd[id]).toBeUndefined();
        continue;
      }
      const end = r.memberEnd[id];
      expect(end.hp).toBeGreaterThan(0);
      expect(end.hp).toBeLessThanOrEqual(end.hpMax);
      for (const s of end.statuses) expect(isCarriedStatus(s.id)).toBe(true);
    }
  });
});
