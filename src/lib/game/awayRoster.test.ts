// E-CREW 0.14.0 (Tasks 12 + 13): the named away-team ROSTER on an expedition.
//
// Task 12, the snapshot at dispatch (awayTeam.ts snapshotAwayRoster):
//   - only READY members deploy (injured ones stay aboard), capped at the hull's squad size, in hire order;
//   - groundStats = the summed worn gear lines converted ONCE (convertGroundPoints) plus trait stat bumps;
//   - trait AND gear effects normalize into one effect list + one capped resist map;
//   - the snapshot is a pure function with no live references;
//   - a ship with no roster launches an expedition byte-identical to before (no `roster` field).

import { describe, it, expect } from "vitest";
import {
  freshState,
  generateStandardIssue,
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
import { expeditionCandidates, startExpedition } from "./expedition";

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
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// A fresh state (ship-1 is a General Freighter: 3 Security + 3 Science slots) with the given members + gear.
function withRoster(members: AwayMember[], gear: EquipmentInstance[] = [], gameTimeSeconds = 1000): GameState {
  const base = freshState();
  return { ...base, gameTimeSeconds, awayMembers: members, equipment: [...base.equipment, ...gear] };
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

  it("a Standard-Issue baseline converts to no bump at all", () => {
    let n = 900;
    const si = generateStandardIssue({ slotType: "memberWeapon", fittedToShipId: null, allocateId: () => `equip-${n++}`, varietyKey: "pulseRifle" });
    const s = withRoster([member("member-1", "security")], [{ ...si, fittedToMemberId: "member-1" }]);
    const [m] = snapshotAwayRoster(s, ship(s)).security;
    for (const v of Object.values(m.groundStats)) expect(v).toBe(0);
    expect(m.gear[0].points).toBe(0);
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

  it("a Security member runs its own program, else the account Security program; Science carries its own inertly", () => {
    const own = [{ target: "foeLowestHp" as const, action: "execute" as const }];
    const s = withRoster([
      member("member-1", "security", { gambit: own }),
      member("member-2", "security"),
      member("member-3", "science"),
    ]);
    const r = snapshotAwayRoster(s, ship(s));
    expect(r.security[0].gambit).toEqual(own);
    expect(r.security[0].gambit).not.toBe(own); // a copy, never the live array
    expect(r.security[1].gambit).toEqual(s.gambitPrograms.security);
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
describe("startExpedition stores the roster (and stays byte-identical without one)", () => {
  function launch(s: GameState) {
    const cand = expeditionCandidates(s, "ship-1")[0];
    const res = startExpedition(s, "ship-1", 1, cand.id);
    expect(res.success).toBe(true);
    return res.next.expeditions[res.next.expeditions.length - 1];
  }

  it("a ship with no roster launches with no roster field at all", () => {
    const exp = launch(freshState());
    expect("roster" in exp).toBe(false);
  });

  it("a ship whose only members are injured launches with no roster field", () => {
    const exp = launch(withRoster([member("member-1", "security", { injuredUntilSeconds: 99_999 })]));
    expect("roster" in exp).toBe(false);
  });

  it("a ship with ready members stores their snapshot", () => {
    const s = withRoster([member("member-1", "security"), member("member-2", "science")]);
    const exp = launch(s);
    expect(exp.roster).toEqual(snapshotAwayRoster(s, ship(s)));
    expect(exp.roster!.security.map((m) => m.memberId)).toEqual(["member-1"]);
    expect(exp.roster!.science.map((m) => m.memberId)).toEqual(["member-2"]);
  });
});
