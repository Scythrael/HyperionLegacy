// E-CREW 0.14.0 (Tasks 12 + 13): the named away-team ROSTER on an expedition.
//
// Task 12, the snapshot at dispatch (awayTeam.ts snapshotAwayRoster):
//   - only READY members deploy (injured ones stay aboard), capped at the hull's squad size, in hire order;
//   - groundStats = the summed worn gear lines converted ONCE (convertGroundPoints) plus trait stat bumps;
//   - trait AND gear effects normalize into one effect list + one capped resist map;
//   - the snapshot is a pure function with no live references;
//   - D18: a ship without 1 ready Security + 1 ready Science member cannot launch at all.
//
// Task 13, Security-only battles with per-member gambits (gambit.ts):
//   - Science never enters a battle; D18: there is no anonymous fallback (no Security, no team: an old
//     in-flight expedition without one evacuates each task without a battle);
//   - each member runs its OWN program; medic actions fire only for a medic (D20: Medical Training only;
//     a Med Kit does nothing without it); team-kit first aid works for anyone at 50%, 125% when trained;
//   - gear effects scale with the piece's stat lines (a Standard-Issue Med Kit heals nothing);
//   - a battle ends only on a clear or a wipe (no objective win);
//   - presets keep their exact titles and are Security-only;
//   - determinism: same seed, same log; offline == live through advanceExpedition with a roster.

import { describe, it, expect } from "vitest";
import {
  freshState,
  generateStandardIssue,
  STANDARD_ISSUE_MEMBER_POINTS,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type EquipmentSlotType,
  type GameState,
} from "./model";
import {
  snapshotAwayRoster,
  convertGroundPoints,
  GEAR_POINT_BUMP,
  STATUS_RESIST_PER_POINT,
  STATUS_RESIST_CAP,
} from "./awayTeam";
import { rankMagnitudeFactor } from "./crewRank";
import { withSiMemberGearOff } from "./siMemberGearSwitch.fixture";
import { advanceExpedition, expeditionCandidates, makeExpeditionSeed, startExpedition } from "./expedition";
import {
  applyStatus,
  buildRosterCombatants,
  canActorUse,
  deriveExpeditionActivityLog,
  firstAidEffectiveness,
  FIRST_AID_HEAL,
  FIRST_AID_TRAINED_EFFECTIVENESS,
  FIRST_AID_UNTRAINED_EFFECTIVENESS,
  evaluateAndAct,
  expeditionTeamCombatants,
  generateEncounter,
  hasStatus,
  resolveExpeditionActivity,
  resolveGroundBattle,
  validateGambitProgram,
  GAMBIT_PRESETS,
  type BattleState,
  type GambitLogEvent,
  type GroundCombatant,
} from "./gambit";
import { planetTypeHazard } from "./expeditionContent";
import { makeRng } from "./combat/rng";
import {
  DEFAULT_GAMBIT_PROGRAMS,
  DEFAULT_MEMBER_GAMBIT,
  type Expedition,
  type GambitProgram,
  type SnapshotMember,
} from "./model";
import { asLegacyDispatch, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";

// ===== fixtures =====

function member(id: string, teamType: AwayTeamType, over: Partial<AwayMember> = {}): AwayMember {
  return {
    id,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    name: `Member ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: 1,
    traits: [],
    assignedShipId: "ship-1",
    ...over,
  };
}

// A crafted member piece worn by `wearer`, with the given ground lines.
function worn(
  id: string,
  slotType: EquipmentSlotType,
  moduleVariant: string,
  wearer: string,
  implicitStats: Record<string, number>,
  rolledStats: Record<string, number> = {}
): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats,
    rolledStats,
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// A fresh state (ship-1 is a General Freighter: 3 Security + 3 Science slots) with the given members + gear.
function withRoster(members: AwayMember[], gear: EquipmentInstance[] = [], gameTimeSeconds = 1000): GameState {
  const base = freshState();
  // Ground Ops (GO-7b): dispatch reads the slotted ground teams; slot the members in hire order.
  return withSlottedAwayTeams({ ...base, gameTimeSeconds, awayMembers: members, equipment: [...base.equipment, ...gear] });
}

const ship = (s: GameState) => s.ships[0];

// ============================================================================
describe("snapshotAwayRoster: who deploys", () => {
  it("excludes injured members; a member whose timer has run out deploys", () => {
    const s = withRoster(
      [
        member("member-1", "security", { injuredUntilSeconds: 5000 }), // still hurt
        member("member-2", "security", { injuredUntilSeconds: 1000 }), // recovers exactly now
        member("member-3", "security"),
        member("member-4", "science", { injuredUntilSeconds: 1001 }),
      ],
      [],
      1000
    );
    const r = snapshotAwayRoster(s, ship(s));
    expect(r.security.map((m) => m.memberId)).toEqual(["member-2", "member-3"]);
    expect(r.science).toEqual([]);
  });

  it("caps each squad at the hull's squad size, choosing in hire order (member number)", () => {
    // Five Security members on a 3-slot squad, listed out of order; "member-10" sorts after "member-9".
    const s = withRoster([
      member("member-10", "security"),
      member("member-2", "security"),
      member("member-9", "security"),
      member("member-1", "security"),
      member("member-3", "security"),
    ]);
    const r = snapshotAwayRoster(s, ship(s));
    expect(r.security.map((m) => m.memberId)).toEqual(["member-1", "member-2", "member-3"]);
  });

  it("only reads members assigned to THIS ship", () => {
    const s = withRoster([member("member-1", "security", { assignedShipId: "ship-9" }), member("member-2", "security", { assignedShipId: null })]);
    expect(snapshotAwayRoster(s, ship(s))).toEqual({ security: [], science: [] });
  });
});

// ============================================================================
describe("snapshotAwayRoster: member power (gear conversion + traits)", () => {
  it("convertGroundPoints converts each line once with the documented coefficients", () => {
    const c = convertGroundPoints({ groundPower: 10, groundHp: 20, groundArmor: 4, groundAccuracy: 5, groundStatusChance: 20, groundStatusResist: 30 });
    expect(c.stats.power).toBeCloseTo(10 * GEAR_POINT_BUMP.power);
    expect(c.stats.hp).toBeCloseTo(20 * GEAR_POINT_BUMP.hp);
    expect(c.stats.armor).toBeCloseTo(4 * GEAR_POINT_BUMP.armor);
    expect(c.stats.accuracy).toBeCloseTo(5 * GEAR_POINT_BUMP.accuracy);
    expect(c.stats.statusChance).toBeCloseTo(0.1); // 20 points * 0.005, an absolute chance
    expect(c.statusResist).toBeCloseTo(30 * STATUS_RESIST_PER_POINT);
    // Every member stat key is present, 0 when nothing feeds it.
    expect(c.stats.fieldwork).toBe(0);
    expect(Object.keys(c.stats).sort()).toEqual(
      ["accuracy", "armor", "fieldwork", "hazardResist", "hp", "power", "relicFind", "statusChance"]
    );
  });

  it("sums every worn piece's lines per member, then adds trait stat bumps (the stacking rule)", () => {
    const s = withRoster(
      [member("member-1", "security", { traits: ["breacher"], rank: 5 })], // breacher: +8% power
      [
        worn("equip-901", "memberWeapon", "pulseRifle", "member-1", { groundPower: 6, groundAccuracy: 6 }, { groundPower: 4 }),
        worn("equip-902", "implant", "adrenalSurge", "member-1", { groundPower: 5 }, { groundHp: 10 }),
      ]
    );
    const [m] = snapshotAwayRoster(s, ship(s)).security;
    expect(m.groundStats.power).toBeCloseTo((6 + 4 + 5) * GEAR_POINT_BUMP.power + 0.08);
    expect(m.groundStats.hp).toBeCloseTo(10 * GEAR_POINT_BUMP.hp);
    expect(m.groundStats.accuracy).toBeCloseTo(6 * GEAR_POINT_BUMP.accuracy);
    expect(m.rankFactor).toBe(rankMagnitudeFactor(5));
    expect(m.implants).toEqual(["adrenalSurge"]);
    expect(m.gear.map((g) => [g.pieceId, g.points])).toEqual([
      ["equip-901", 16],
      ["equip-902", 15],
    ]);
  });

  // 0.14.0: the Quartermaster's Standard-Issue set carries real lines (model.ts STANDARD_ISSUE_MEMBER_POINTS), which
  // convert like any crafted line. Switched off, a baseline converts to no bump at all, as before.
  it("a Standard-Issue baseline converts its Standard-Issue lines (none with the stats switched off)", () => {
    let n = 900;
    const mint = () => generateStandardIssue({ slotType: "memberWeapon", fittedToShipId: null, allocateId: () => `equip-${n++}`, varietyKey: "pulseRifle" });
    const s = withRoster([member("member-1", "security")], [{ ...mint(), fittedToMemberId: "member-1" }]);
    const [m] = snapshotAwayRoster(s, ship(s)).security;
    const points = STANDARD_ISSUE_MEMBER_POINTS;
    expect(m.groundStats.power).toBeCloseTo((points / 2) * GEAR_POINT_BUMP.power, 10);
    expect(m.groundStats.accuracy).toBeCloseTo((points / 2) * GEAR_POINT_BUMP.accuracy, 10);
    expect(m.gear[0].points).toBe(points);
    withSiMemberGearOff(() => {
      const off = withRoster([member("member-1", "security")], [{ ...mint(), fittedToMemberId: "member-1" }]);
      const [z] = snapshotAwayRoster(off, ship(off)).security;
      for (const v of Object.values(z.groundStats)) expect(v).toBe(0);
      expect(z.gear[0].points).toBe(0);
    });
  });
});

// ============================================================================
describe("snapshotAwayRoster: effect normalization", () => {
  it("folds trait effects and gear effects into one list, each gear effect carrying its piece's points", () => {
    const s = withRoster(
      [member("member-1", "security", { traits: ["fieldMedic", "quickDraw", "bulwark"] })],
      [
        worn("equip-901", "memberWeapon", "shockBaton", "member-1", { groundPower: 5, groundStatusChance: 5 }),
        worn("equip-902", "memberTool", "medKit", "member-1", { groundHp: 12 }, { groundArmor: 3 }),
        worn("equip-903", "memberArmor", "assaultHardsuit", "member-1", { groundArmor: 4, groundHp: 4 }),
      ]
    );
    const [m] = snapshotAwayRoster(s, ship(s)).security;
    expect(m.effects).toEqual([
      { kind: "inflict", status: "stun", points: 10 },
      { kind: "heal", points: 15 },
      { kind: "medic" },
      { kind: "firstStrike" },
      { kind: "guard", allyHpBelow: 0.4 },
    ]);
  });

  it("merges trait resists and gear resists into one capped map; gear resist covers every listed status", () => {
    const s = withRoster(
      [member("member-1", "security", { traits: ["ironWill"] })], // ironWill: fear 0.5
      [worn("equip-901", "implant", "cortexShield", "member-1", { groundStatusResist: 25 })] // stun + fear
    );
    const [m] = snapshotAwayRoster(s, ship(s)).security;
    expect(m.resists.stun).toBeCloseTo(0.25);
    expect(m.resists.fear).toBeCloseTo(0.75);
    expect(m.resists.poison).toBeUndefined();

    // Enough points to overflow: capped so nobody is immune.
    const big = withRoster(
      [member("member-1", "security", { traits: ["ironWill"] })],
      [worn("equip-901", "implant", "cortexShield", "member-1", { groundStatusResist: 90 })]
    );
    expect(snapshotAwayRoster(big, ship(big)).security[0].resists.fear).toBe(STATUS_RESIST_CAP);
  });

  // D19 DELIBERATE CHANGE: a Security member with no program used to get the ACCOUNT Security program
  // (state.gambitPrograms.security). It now gets the built-in DEFAULT_MEMBER_GAMBIT, unlinked from it.
  it("a Security member runs its own program, else the built-in default; Science carries its own inertly", () => {
    const own = [{ target: "foeLowestHp" as const, action: "execute" as const }];
    const s = withRoster([
      member("member-1", "security", { gambit: own }),
      member("member-2", "security"),
      member("member-3", "science"),
    ]);
    const r = snapshotAwayRoster(s, ship(s));
    expect(r.security[0].gambit).toEqual(own);
    expect(r.security[0].gambit).not.toBe(own); // a copy, never the live array
    expect(r.security[1].gambit).toEqual(DEFAULT_MEMBER_GAMBIT);
    expect(r.security[1].gambit).not.toBe(DEFAULT_MEMBER_GAMBIT); // a copy, never the shared constant
    expect(r.science[0].gambit).toEqual([]);
  });
});

// ============================================================================
describe("snapshotAwayRoster: purity", () => {
  it("is a pure function: same input, same output, and the input is untouched", () => {
    const s = withRoster(
      [member("member-1", "security", { traits: ["steadyAim"] }), member("member-2", "science", { traits: ["keenEye"] })],
      [worn("equip-901", "memberWeapon", "pulseRifle", "member-1", { groundPower: 6 })]
    );
    const before = JSON.stringify(s);
    const a = snapshotAwayRoster(s, ship(s));
    const b = snapshotAwayRoster(s, ship(s));
    expect(a).toEqual(b);
    expect(JSON.stringify(s)).toBe(before);
    expect(a.security[0].traits).not.toBe(s.awayMembers[0].traits);
  });
});

// ============================================================================
describe("startExpedition stores the roster (D18: and refuses without the minimum team)", () => {
  function launch(s: GameState) {
    const cand = expeditionCandidates(s, "ship-1")[0];
    const res = dispatchPastPropulsion(s, "ship-1", 1, cand.id);
    expect(res.success).toBe(true);
    return res.next.expeditions[res.next.expeditions.length - 1];
  }

  // D18 DELIBERATE CHANGE: these two used to LAUNCH with no roster field (the anonymous crew detail fought).
  // A ship with no roster can no longer launch, so they now assert the refusal.
  it("a ship with no roster is refused (needsAwayTeam)", () => {
    const s = freshState();
    const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.success).toBe(false);
    expect(res.reason).toBe("needsAwayTeam");
    expect(res.next).toBe(s);
  });

  it("a ship whose only members are injured is refused", () => {
    const s = withRoster([
      member("member-1", "security", { injuredUntilSeconds: 99_999 }),
      member("member-2", "science", { injuredUntilSeconds: 99_999 }),
    ]);
    const res = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    expect(res.reason).toBe("needsAwayTeam");
  });

  it("a ship with ready members stores their snapshot", () => {
    const s = withRoster([member("member-1", "security"), member("member-2", "science")]);
    const exp = launch(s);
    expect(exp.roster).toEqual(snapshotAwayRoster(s, ship(s)));
    expect(exp.roster!.security.map((m) => m.memberId)).toEqual(["member-1"]);
    expect(exp.roster!.science.map((m) => m.memberId)).toEqual(["member-2"]);
  });
});

// ============================================================================
// Task 13 fixtures
// ============================================================================

// A snapshotted Security member with neutral stats; callers override effects / program / stats.
function snap(memberId: string, over: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    memberId,
    teamType: "security",
    spec: "offense",
    rank: 1,
    rankFactor: 1,
    traits: [],
    groundStats: { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 },
    resists: {},
    implants: [],
    gear: [],
    gambit: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r })),
    effects: [],
    ...over,
  };
}

function enemy(id: string, over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side: "enemy",
    role: "bruiser",
    hp: 60,
    hpMax: 60,
    power: 8,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 8,
    groupTag: "bruiser",
    statuses: [],
    downed: false,
    ...over,
  };
}

function battle(combatants: GroundCombatant[]): BattleState {
  return { combatants, round: 0, teamKit: 0, tauntedBy: null };
}

// A minimal expedition (one terrestrial body), mirroring gambit.test.ts makeExp.
function makeExp(over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "transit",
    phaseAnchorSeconds: 0,
    shakedown: true,
    bodies: [
      { id: "body-1", planetType: "terrestrial", scanTotal: 100, scanProgress: 0, hazard: planetTypeHazard("terrestrial"), scanned: false, discoveries: [], activities: [] },
    ],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 12345,
    securityStrength: 8,
    scienceStrength: 6,
    teamKit: 2,
    gambitPrograms: { security: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r })), science: [] },
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    ...over,
  };
}

const ACT = { id: "expedition-1-body-1-act-0", bodyId: "body-1", poiId: "buriedVault", done: false };

// ============================================================================
describe("Task 13: Science never enters a battle", () => {
  // D18 DELIBERATE CHANGE: the old first test here proved the ANONYMOUS fallback fielded Security only.
  // The fallback (buildTeamCombatants) is deleted, so the test now proves there is no stand-in at all.
  it("D18: with no Security member there is no stand-in team, at any crew strength", () => {
    for (const str of [0, 5, 12, 40]) {
      expect(expeditionTeamCombatants(makeExp({ securityStrength: str }), "x")).toEqual([]);
    }
  });

  it("a roster's Science members never become combatants; Security members do, one each", () => {
    const exp = makeExp({
      roster: { security: [snap("member-1"), snap("member-2")], science: [snap("member-3", { teamType: "science", spec: "geology" })] },
    });
    const team = expeditionTeamCombatants(exp, "x");
    expect(team.map((c) => c.memberId)).toEqual(["member-1", "member-2"]);
    expect(team.every((c) => c.role === "security")).toBe(true);
  });

  // D18 DELIBERATE CHANGE: a Science-only roster used to fall back to the anonymous detail. Now it, like an
  // old in-flight expedition with no roster at all, fields NO team and each task evacuates without a battle.
  it("a Science-only roster resolves exactly like no roster: no battle, an evacuation with a partial haul", () => {
    const sciOnly = makeExp({ roster: { security: [], science: [snap("member-3", { teamType: "science", spec: "geology" })] } });
    const none = makeExp();
    expect(expeditionTeamCombatants(sciOnly, "x")).toEqual([]);
    const a = resolveExpeditionActivity(sciOnly, sciOnly.bodies[0], ACT, 0);
    expect(a).toEqual(resolveExpeditionActivity(none, none.bodies[0], ACT, 0));
    expect(a.outcome).toBe("evacuated");
    expect(a.attempts).toBe(0); // no battle was fought
    expect(a.finding.evacuated).toBe(true);
    expect(a.finding.relic).toBeNull();
    expect(Object.keys(a.finding.materials ?? {}).length).toBeGreaterThan(0); // always win something
    expect(deriveExpeditionActivityLog(none, none.bodies[0], ACT, 0)).toEqual({ outcome: "evacuated", attempts: 0, events: [] });
  });
});

// ============================================================================
// D18: an expedition launched BEFORE the minimum-team gate (an existing dev save) may carry no roster. It
// must still run to completion without crashing or stalling, deterministically and offline == live.
describe("D18: an in-flight expedition with no roster resolves safely", () => {
  const noRosterExp = () =>
    makeExp({
      seed: makeExpeditionSeed(0x2545f491, 9),
      securityStrength: 30,
      bodies: [
        { id: "body-1", planetType: "toxic", scanTotal: 110, scanProgress: 0, hazard: planetTypeHazard("toxic"), scanned: false, discoveries: [], activities: [] },
        { id: "body-2", planetType: "frozen", scanTotal: 90, scanProgress: 0, hazard: planetTypeHazard("frozen"), scanned: false, discoveries: [], activities: [] },
      ],
    });

  it("completes, every ground task evacuates with a partial haul, and one big advance == many small", () => {
    const exp = noRosterExp();
    expect("roster" in exp).toBe(false);
    const big = advanceExpedition(exp, 300_000);
    let stepped = noRosterExp();
    for (let t = 100; t <= 300_000; t += 100) stepped = advanceExpedition(stepped, t);
    expect(stepped).toEqual(big);
    expect(big.phase).toBe("complete");
    const acts = big.findings.filter((f) => f.source === "activity");
    expect(acts.length).toBeGreaterThan(0);
    for (const f of acts) {
      expect(f.evacuated).toBe(true);
      expect(f.relic).toBeNull();
      expect(Object.keys(f.materials ?? {}).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
describe("Task 13: per-member gambits", () => {
  it("two members with two different programs take two different first actions", () => {
    const tank = snap("member-1", { gambit: [{ target: "foeHighestHp", action: "taunt" }] });
    const striker = snap("member-2", { gambit: [{ target: "foeNearest", action: "attack" }] });
    const log: GambitLogEvent[] = [];
    resolveGroundBattle(
      buildRosterCombatants([tank, striker], 8, "x"),
      [enemy("enemy-bruiser-1")],
      0,
      makeRng(42),
      log
    );
    const firstRound = log.filter((e) => e.round === 1 && e.side === "team");
    expect(firstRound.map((e) => [e.memberId, e.action])).toEqual([
      ["member-1", "taunt"],
      ["member-2", "attack"],
    ]);
  });

  it("every preset keeps its exact title, is Security-only, and validates clean for Security", () => {
    expect(GAMBIT_PRESETS.map((p) => p.title)).toEqual([
      "Establish Dominance",
      "Decapitate",
      "Turtle Club President",
      "Triage",
      "Balanced",
      "Custom",
    ]);
    for (const p of GAMBIT_PRESETS) {
      expect(p.programs.science).toEqual([]);
      expect(validateGambitProgram("security", p.programs.security)).toEqual([]);
    }
    // Triage is MEDIC PRIORITY: it leads with the medic actions.
    const triage = GAMBIT_PRESETS.find((p) => p.title === "Triage")!;
    expect(triage.programs.security.slice(0, 2).map((r) => r.action)).toEqual(["cure", "aidHeal"]);
  });
});

// ============================================================================
// D19 DEFAULT MEMBER GAMBITS (user, 2026-10-06): "A default set of gambits that covers everything but
// automatic kit use should be assigned by default unless one is set up." Not linked to an account program.
describe("D19: the built-in default member program", () => {
  it("has NO automatic kit use: no Use Item rule", () => {
    expect(DEFAULT_MEMBER_GAMBIT.some((r) => r.action === "useItem")).toBe(false);
  });

  it("covers targeting, attack and defense, and validates clean for Security", () => {
    const actions = new Set(DEFAULT_MEMBER_GAMBIT.map((r) => r.action));
    expect(actions.has("attack")).toBe(true);
    expect(actions.has("execute")).toBe(true);
    expect(actions.has("brace")).toBe(true); // defense
    const targets = new Set(DEFAULT_MEMBER_GAMBIT.map((r) => r.target));
    expect(targets.has("foeIsHealer")).toBe(true); // smart targeting, not just "nearest"
    expect(targets.has("foeNearest")).toBe(true); // an always-firing fallback, so a member never idles
    expect(validateGambitProgram("security", DEFAULT_MEMBER_GAMBIT)).toEqual([]);
  });

  it("is not a preset, and the six preset titles are unchanged", () => {
    expect(GAMBIT_PRESETS.some((p) => JSON.stringify(p.programs.security) === JSON.stringify(DEFAULT_MEMBER_GAMBIT))).toBe(false);
    expect(GAMBIT_PRESETS.map((p) => p.title)).toEqual([
      "Establish Dominance",
      "Decapitate",
      "Turtle Club President",
      "Triage",
      "Balanced",
      "Custom",
    ]);
  });

  it("a hand-built Security combatant with no program runs the default (never an account pair)", () => {
    const loner: GroundCombatant = { ...enemy("t-sec-0"), side: "team", role: "security", groupTag: "security" };
    const healer = enemy("enemy-healer-1", { role: "healer", groupTag: "healer" });
    const log: GambitLogEvent[] = [];
    resolveGroundBattle([loner], [enemy("enemy-bruiser-1"), healer], 0, makeRng(4), log);
    const first = log.find((e) => e.side === "team")!;
    expect(first.action).toBe("attack");
    expect(first.targetRole).toBe("healer"); // the default's targeting: kill the healer first
  });

  it("editing the ACCOUNT program changes no member: same snapshot, same expedition outcome", () => {
    const base = withRoster([member("member-1", "security"), member("member-2", "science")]);
    const hold: GameState = { ...base, gambitPrograms: { security: [{ target: "self", action: "hold" }], science: [] } };
    const lazy: GameState = { ...base, gambitPrograms: { security: [{ target: "foeNearest", action: "attack" }], science: [] } };
    expect(snapshotAwayRoster(hold, ship(hold))).toEqual(snapshotAwayRoster(lazy, ship(lazy)));
    // A legacy run (asLegacyDispatch): it must reach "complete" with a lone plain member, which only the legacy
    // evacuation path guarantees (a Ground Ops run holds a task it cannot win, user Q4).
    const run = (s: GameState) => {
      const res = asLegacyDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
      expect(res.success).toBe(true);
      return advanceExpedition(res.expedition!, 1_000_000);
    };
    const a = run(hold);
    expect(a.phase).toBe("complete");
    expect(run(lazy)).toEqual(a);
  });
});

// ============================================================================
describe("Task 13: medic legality and gear effects that scale with stat lines", () => {
  const cureFirst: GambitProgram = [
    { target: "allyHasStatus", action: "cure" },
    { target: "foeNearest", action: "attack" },
  ];

  function afflictedAlly(): GroundCombatant {
    const [ally] = buildRosterCombatants([snap("member-9")], 0, "ally");
    applyStatus(ally, "poison");
    return ally;
  }

  it("a plain Security member cannot cure: the rule is skipped and the next one fires", () => {
    const [plain] = buildRosterCombatants([snap("member-1", { gambit: cureFirst })], 0, "x");
    const ally = afflictedAlly();
    const foe = enemy("enemy-bruiser-1");
    expect(canActorUse(plain, "cure")).toBe(false);
    evaluateAndAct(plain.program!, plain, battle([plain, ally, foe]), makeRng(1));
    expect(hasStatus(ally, "poison")).toBe(true);
  });

  it("a member with Medical Training cures", () => {
    const [medic] = buildRosterCombatants([snap("member-1", { gambit: cureFirst, effects: [{ kind: "medic" }] })], 0, "x");
    const ally = afflictedAlly();
    expect(canActorUse(medic, "cure")).toBe(true);
    evaluateAndAct(medic.program!, medic, battle([medic, ally, enemy("enemy-bruiser-1")]), makeRng(1));
    expect(hasStatus(ally, "poison")).toBe(false);
  });

  // D20 DELIBERATE CHANGE: a Med Kit used to make ANY carrier a medic (cure + aidHeal) and heal by its
  // points. The Med Kit now requires Medical Training: without it the kit does nothing in battle.
  it("D20: a Med Kit WITHOUT Medical Training grants nothing (no cure, no aidHeal, heal 0, at any points)", () => {
    for (const points of [0, 10, 40]) {
      const [kitOnly] = buildRosterCombatants([snap("member-1", { gambit: cureFirst, effects: [{ kind: "heal", points }] })], 0, "x");
      expect(kitOnly.medic).toBeUndefined();
      expect(kitOnly.heal).toBe(0);
      expect(canActorUse(kitOnly, "cure")).toBe(false);
      expect(canActorUse(kitOnly, "aidHeal")).toBe(false);
      const ally = afflictedAlly();
      evaluateAndAct(kitOnly.program!, kitOnly, battle([kitOnly, ally, enemy("enemy-bruiser-1")]), makeRng(1));
      expect(hasStatus(ally, "poison")).toBe(true); // the cure rule was skipped
    }
  });

  // D20 DELIBERATE CHANGE: rewritten around Medical Training (the Med Kit counts only for a trained member).
  it("a trained member's heal: bare-handed base, plus a crafted Med Kit by its points; a Standard-Issue kit adds 0", () => {
    const trained = (points?: number) =>
      buildRosterCombatants(
        [snap("member-1", { effects: points === undefined ? [{ kind: "medic" }] : [{ kind: "medic" }, { kind: "heal", points }] })],
        0,
        "x"
      )[0];
    const bare = trained();
    expect(bare.heal).toBeGreaterThan(0); // Medical Training heals bare-handed
    expect(trained(0).heal).toBe(bare.heal); // a Standard-Issue Med Kit (0 lines) adds nothing
    const small = trained(10).heal - bare.heal;
    const big = trained(40).heal - bare.heal;
    expect(small).toBeGreaterThan(0);
    expect(big).toBeCloseTo(small * 4);

    // An untrained member with no heal falls through aidHeal to the next rule.
    const healFirst: GambitProgram = [
      { target: "allyHpBelow", params: { hpThreshold: 0.9 }, action: "aidHeal" },
      { target: "self", action: "brace" },
    ];
    const [plain] = buildRosterCombatants([snap("member-1", { gambit: healFirst, effects: [{ kind: "heal", points: 40 }] })], 0, "x");
    const hurt = buildRosterCombatants([snap("member-9")], 0, "ally")[0];
    hurt.hp = 10;
    evaluateAndAct(plain.program!, plain, battle([plain, hurt, enemy("enemy-bruiser-1")]), makeRng(1));
    expect(hurt.hp).toBe(10); // no heal fired
    expect(hasStatus(plain, "shielded")).toBe(true); // the next rule (brace) fired instead
  });

  it("group hit and inflict take their strength from the stat lines; a Standard-Issue piece adds none", () => {
    const [siScatter] = buildRosterCombatants([snap("member-1", { effects: [{ kind: "groupHit", points: 0 }] })], 0, "x");
    expect(siScatter.groupHit).toBeUndefined();
    const [scatter] = buildRosterCombatants([snap("member-1", { effects: [{ kind: "groupHit", points: 20 }] })], 0, "x");
    expect(scatter.groupHit).toBeGreaterThan(0);

    // Inflict rolls at the member's statusChance: 0 for an offense member with Standard-Issue lines.
    const [siBaton] = buildRosterCombatants([snap("member-1", { effects: [{ kind: "inflict", status: "stun", points: 0 }] })], 0, "x");
    expect(siBaton.onHitStatuses).toBeUndefined();
    const lines = { ...snap("m").groundStats, statusChance: 0.2 };
    const [baton] = buildRosterCombatants(
      [snap("member-1", { groundStats: lines, effects: [{ kind: "inflict", status: "stun", points: 10 }] })],
      0,
      "x"
    );
    expect(baton.onHitStatuses).toEqual([{ id: "stun", permille: 200 }]);
  });

  it("a scattergun's splash damages the rest of the target's group", () => {
    const [scatter] = buildRosterCombatants(
      [snap("member-1", { gambit: [{ target: "foeNearest", action: "attack" }], effects: [{ kind: "groupHit", points: 40 }] })],
      0,
      "x"
    );
    scatter.accuracy = 1;
    const a = enemy("enemy-swarm-1", { groupTag: "swarm", role: "swarm" });
    const b = enemy("enemy-swarm-2", { groupTag: "swarm", role: "swarm" });
    const other = enemy("enemy-zbruiser-1");
    evaluateAndAct(scatter.program!, scatter, battle([scatter, a, b, other]), makeRng(3));
    expect(a.hp).toBeLessThan(a.hpMax);
    expect(b.hp).toBeLessThan(b.hpMax);
    expect(other.hp).toBe(other.hpMax);
  });

  it("a member's resist can shrug off an enemy affliction", () => {
    const [immune] = buildRosterCombatants([snap("member-1")], 0, "x");
    immune.resists = { poison: 1000 };
    const caster = enemy("enemy-caster-1", { role: "caster", statusOnHit: { id: "poison", permille: 1000 } });
    evaluateAndAct([{ target: "foeNearest", action: "attack" }], caster, battle([immune, caster]), makeRng(7));
    expect(immune.hp).toBeLessThan(immune.hpMax); // the hit landed
    expect(hasStatus(immune, "poison")).toBe(false); // the affliction was resisted
  });

  it("a Quick Draw member acts first on the opening round; a Bulwark takes hits meant for a hurt ally", () => {
    const hold: GambitProgram = [];
    const roster = [
      snap("member-1", { gambit: hold }),
      snap("member-2", { gambit: [{ target: "self", action: "brace" }], effects: [{ kind: "firstStrike" }] }),
      snap("member-3", { gambit: hold, effects: [{ kind: "guard", allyHpBelow: 0.4 }] }),
    ];
    const team = buildRosterCombatants(roster, 0, "x");
    team[0].hp = 5; // member-1 is badly hurt
    const log: GambitLogEvent[] = [];
    // A lone striker always goes for the lowest-HP foe (member-1); the Bulwark steps in front.
    resolveGroundBattle(team, [enemy("enemy-striker-1", { role: "striker", power: 1 })], 0, makeRng(5), log);
    const round1 = log.filter((e) => e.round === 1);
    expect(round1[0].memberId).toBe("member-2"); // first strike, despite the higher id
    const strike = round1.find((e) => e.side === "enemy")!;
    expect(strike.targetMemberId).toBe("member-3");
  });
});

// ============================================================================
// D20 (user, 2026-10-06): team-kit consumables ("Use Item", first aid) work for ANYONE, at 50% without
// Medical Training and with a +25% boost (125%) with it. Grenades need no training ("Pull a pin").
describe("D20: first aid effectiveness and untrained tools", () => {
  const useItemFirst: GambitProgram = [{ target: "allyHasStatus", action: "useItem" }];

  function aidOnce(effects: SnapshotMember["effects"]) {
    const [actor] = buildRosterCombatants([snap("member-1", { gambit: useItemFirst, effects })], 0, "x");
    const ally = buildRosterCombatants([snap("member-9")], 0, "ally")[0];
    ally.hp = 20;
    applyStatus(ally, "poison"); // 4 rounds
    const state: BattleState = { combatants: [actor, ally, enemy("enemy-bruiser-1")], round: 0, teamKit: 2, tauntedBy: null };
    evaluateAndAct(actor.program!, actor, state, makeRng(1));
    return { actor, ally, state };
  }

  it("the constants are 0.5x untrained and 1.25x trained", () => {
    expect(FIRST_AID_UNTRAINED_EFFECTIVENESS).toBe(0.5);
    expect(FIRST_AID_TRAINED_EFFECTIVENESS).toBe(1.25);
    expect(firstAidEffectiveness({})).toBe(0.5);
    expect(firstAidEffectiveness({ medic: true })).toBe(1.25);
  });

  it("an untrained member CAN use team kit, at 50%: the debuff is halved and the patch is half", () => {
    const { actor, ally, state } = aidOnce([]);
    expect(canActorUse(actor, "useItem")).toBe(true);
    expect(state.teamKit).toBe(1); // one kit spent
    expect(ally.statuses.find((s) => s.id === "poison")?.remaining).toBe(2); // 4 rounds, halved
    expect(ally.hp).toBe(20 + Math.round(FIRST_AID_HEAL * 0.5));
  });

  it("a Medical Training member uses it at 125%: the debuff is cleared and the patch is boosted", () => {
    const { ally, state } = aidOnce([{ kind: "medic" }]);
    expect(state.teamKit).toBe(1);
    expect(hasStatus(ally, "poison")).toBe(false);
    expect(ally.hp).toBe(20 + Math.round(FIRST_AID_HEAL * 1.25));
  });

  it("trained first aid restores 2.5x what untrained first aid does (before rounding)", () => {
    const untrained = aidOnce([]).ally.hp - 20;
    const trained = aidOnce([{ kind: "medic" }]).ally.hp - 20;
    expect(trained).toBeGreaterThan(untrained);
    expect(trained / untrained).toBeCloseTo(1.25 / 0.5, 0);
  });

  it("with no kit left, Use Item does not fire (no free first aid)", () => {
    const [actor] = buildRosterCombatants([snap("member-1", { gambit: useItemFirst })], 0, "x");
    const ally = buildRosterCombatants([snap("member-9")], 0, "ally")[0];
    applyStatus(ally, "poison");
    evaluateAndAct(actor.program!, actor, battle([actor, ally, enemy("enemy-bruiser-1")]), makeRng(1)); // teamKit 0
    expect(ally.statuses.find((s) => s.id === "poison")?.remaining).toBe(4);
  });

  it("grenades need no training: an untrained member's grenade still lands its status", () => {
    const lines = { ...snap("m").groundStats, statusChance: 0.3 };
    const [thrower] = buildRosterCombatants(
      [snap("member-1", { groundStats: lines, effects: [{ kind: "inflict", status: "stun", points: 10 }] })],
      0,
      "x"
    );
    expect(thrower.medic).toBeUndefined();
    expect(thrower.onHitStatuses).toEqual([{ id: "stun", permille: 300 }]);
    for (const a of ["attack", "suppress", "execute", "taunt", "brace", "useItem", "fallBack", "hold"] as const) {
      expect(canActorUse(thrower, a), a).toBe(true); // only cure / aidHeal are gated on Medical Training
    }
  });
});

// ============================================================================
describe("Task 13: a battle ends only on a clear or a wipe", () => {
  it("a team that cannot clear and cannot fall runs to the round cap and LOSES (no objective win)", () => {
    // A hand-built Science-role actor spamming the old secureObjective (which used to WIN in 3 rounds)
    // against a foe that can never hit it.
    const sci: GroundCombatant = {
      ...enemy("t-sci-0"),
      side: "team",
      role: "science",
      hp: 10_000,
      hpMax: 10_000,
      groupTag: "science",
      program: [{ target: "self", action: "secureObjective" }],
    };
    const res = resolveGroundBattle([sci], [enemy("enemy-bruiser-1", { accuracy: 0 })], 0, makeRng(9));
    expect(res.result).toBe("loss");
    expect(res.teamAliveCount).toBe(1);
    expect(res.enemyAliveCount).toBe(1);
    expect("objective" in res).toBe(false);
  });

  it("every win is a clear and every loss is a wipe or the round cap, across many roster fights", () => {
    const roster = [snap("member-1"), snap("member-2", { spec: "defense" }), snap("member-3", { effects: [{ kind: "medic" }] })];
    for (let s = 0; s < 40; s++) {
      const seed = (0x777 ^ Math.imul(s + 1, 0x9e3779b9)) >>> 0;
      const res = resolveGroundBattle(
        buildRosterCombatants(roster, 6, `b${s}`),
        generateEncounter(seed, 0.4, "buriedVault"),
        2,
        makeRng(seed)
      );
      if (res.result === "win") expect(res.enemyAliveCount).toBe(0);
      else expect(res.teamAliveCount === 0 || res.rounds >= 39).toBe(true);
    }
  });
});

// ============================================================================
describe("Task 13: determinism with a roster", () => {
  // A real roster snapshot (members + crafted gear) frozen onto a multi-body expedition.
  function rosterExp(): Expedition {
    const s = withRoster(
      [
        member("member-1", "security", { traits: ["fieldMedic"], spec: "defense", rank: 3 }),
        member("member-2", "security", {
          traits: ["breacher", "quickDraw"],
          gambit: [
            { target: "foeIsHealer", action: "attack" },
            { target: "foeNearest", action: "attack" },
          ],
        }),
        member("member-3", "security", { spec: "debuff", traits: ["bulwark"] }),
        member("member-4", "science"),
      ],
      [
        worn("equip-901", "memberWeapon", "scattergun", "member-2", { groundPower: 8 }, { groundAccuracy: 6 }),
        worn("equip-902", "memberWeapon", "shockBaton", "member-3", { groundPower: 5, groundStatusChance: 9 }),
        worn("equip-903", "memberTool", "medKit", "member-1", { groundHp: 14 }),
        worn("equip-904", "implant", "toxinFilters", "member-1", { groundStatusResist: 30 }),
      ]
    );
    return makeExp({
      seed: makeExpeditionSeed(0x2545f491, 9),
      roster: snapshotAwayRoster(s, ship(s)),
      bodies: [
        { id: "body-1", planetType: "toxic", scanTotal: 110, scanProgress: 0, hazard: planetTypeHazard("toxic"), scanned: false, discoveries: [], activities: [] },
        { id: "body-2", planetType: "frozen", scanTotal: 90, scanProgress: 0, hazard: planetTypeHazard("frozen"), scanned: false, discoveries: [], activities: [] },
      ],
    });
  }

  it("same seed, same battle log", () => {
    const exp = rosterExp();
    const act = { ...ACT, poiId: "subterraneanCivilization" };
    const a = deriveExpeditionActivityLog(exp, exp.bodies[0], act, 1);
    const b = deriveExpeditionActivityLog(exp, exp.bodies[0], act, 1);
    expect(a).toEqual(b);
    expect(a.events.some((e) => e.memberId !== undefined)).toBe(true);
  });

  it("offline == live: one big advanceExpedition equals many small steps", () => {
    const big = advanceExpedition(rosterExp(), 300_000);
    let stepped = rosterExp();
    for (let t = 100; t <= 300_000; t += 100) stepped = advanceExpedition(stepped, t);
    expect(stepped).toEqual(big);
    expect(big.phase).toBe("complete");
    expect(big.findings.filter((f) => f.source === "activity").length).toBeGreaterThan(0);
  });

  // D18 DELIBERATE CHANGE: without a roster this used to field the anonymous detail; now it fields nobody.
  it("the roster's Security members fight; without a roster nobody does", () => {
    const withR = rosterExp();
    const without = { ...withR };
    delete without.roster;
    expect(expeditionTeamCombatants(withR, "x").map((c) => c.memberId)).toEqual(["member-1", "member-2", "member-3"]);
    expect(expeditionTeamCombatants(without, "x")).toEqual([]);
  });
});
