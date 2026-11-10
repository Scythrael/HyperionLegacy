// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10, USER ANSWERS 2026-10-15 OC-F):
// each answered lever acts as answered, only on a run stamped with the away rules, and the determinism holds.

import { describe, expect, it } from "vitest";
import { GAMBIT_STATUSES, FALL_BACK_SHIELD_ROUNDS, resolveGroundBattle, type GambitLogEvent, type GroundCombatant } from "./gambit";
import { CASTER_CORRODE_PERMILLE, taskFightGuard, withCorrodingCasters } from "./groundFight";
import { fieldworkEffect, fieldworkSpeedMult, memberFieldworkFactor, memberFieldworkTotal } from "./fieldwork";
import { advanceExpedition } from "./expedition";
import { makeRng } from "./combat/rng";
import { accountProgramForHire } from "./awayTeam";
import { DEFAULT_GAMBIT_PROGRAMS, freshState } from "./model";
import { gambitPresetPrograms } from "./gambit";
import { WR10_SCIENCE, wr10Dispatch, wr10Hires } from "./wr10.fixture";
import { withWr10Off } from "./wr10Switch.fixture";

function fighter(over: Partial<GroundCombatant> & Pick<GroundCombatant, "id" | "side" | "role">): GroundCombatant {
  return { hp: 40, hpMax: 40, power: 10, accuracy: 1, armor: 0, heal: 0, threat: 10, groupTag: over.role, statuses: [], downed: false, ...over };
}

// A wearer and a frail squadmate against one striker (it executes the lowest HP foe first, so the squadmate falls first).
function backupFight(awayRules: boolean): ReturnType<typeof resolveGroundBattle> {
  const team = [
    fighter({ id: "a-wearer", side: "team", role: "security", memberId: "wearer", program: [], revive: { permille: 1000, hpFraction: 0.5 } }),
    fighter({ id: "b-frail", side: "team", role: "security", memberId: "frail", program: [], hp: 1, hpMax: 40 }),
  ];
  const enemies = [fighter({ id: "enemy-striker-1", side: "enemy", role: "striker", power: 30, hp: 500, hpMax: 500 })];
  return resolveGroundBattle(team, enemies, 0, makeRng(7), undefined, 0x1234, undefined, awayRules);
}

describe("OC-F2 Neural Backup revives the wearer", () => {
  it("before the away rules the first ally downed takes the roll (B13)", () => {
    expect(backupFight(false).neuralBackup).toEqual({ memberId: "frail", revived: true });
  });
  it("under the away rules a squadmate going down spends nothing; the wearer comes back", () => {
    const r = backupFight(true);
    expect(r.neuralBackup).toEqual({ memberId: "wearer", revived: true });
  });
  it("a battle where the wearer never goes down rolls nothing", () => {
    const team = [
      fighter({ id: "a-wearer", side: "team", role: "security", memberId: "wearer", program: [{ target: "foeNearest", action: "attack" }], revive: { permille: 1000, hpFraction: 0.5 }, hp: 400, hpMax: 400, power: 60 }),
      fighter({ id: "b-frail", side: "team", role: "security", memberId: "frail", program: [], hp: 1, hpMax: 40 }),
    ];
    const enemies = [fighter({ id: "enemy-striker-1", side: "enemy", role: "striker", power: 5, hp: 60, hpMax: 60 })];
    const r = resolveGroundBattle(team, enemies, 0, makeRng(3), undefined, 0x55, undefined, true);
    expect(r.downedMemberIds).toContain("frail");
    expect(r.neuralBackup).toBeUndefined();
  });
});

describe("OC-F6 Fall Back braces for the round", () => {
  const fight = (awayRules: boolean, log: GambitLogEvent[]) => {
    const team = [fighter({ id: "a-m", side: "team", role: "security", memberId: "m", program: [{ target: "self", action: "fallBack" }], hp: 400, hpMax: 400 })];
    const enemies = [fighter({ id: "enemy-bruiser-1", side: "enemy", role: "bruiser", power: 20 })];
    return resolveGroundBattle(team, enemies, 0, makeRng(9), log, 0x77, undefined, awayRules);
  };
  it("under the away rules the member is Shielded for the round it falls back in, so it takes less", () => {
    const on: GambitLogEvent[] = [];
    const off: GambitLogEvent[] = [];
    fight(true, on);
    fight(false, off);
    expect(on.find((e) => e.action === "fallBack")?.statusApplied).toBe(true);
    expect(off.find((e) => e.action === "fallBack")?.statusApplied).toBeUndefined();
    const hit = (log: GambitLogEvent[]) => log.find((e) => e.side === "enemy" && (e.hpDelta ?? 0) < 0)?.hpDelta ?? 0;
    // The same hit roll (Fall Back draws nothing), taken through the Shielded cut.
    expect(Math.abs(hit(on))).toBeLessThan(Math.abs(hit(off)));
    expect(Math.abs(hit(on))).toBe(Math.max(1, Math.round(Math.abs(hit(off)) * (1 - GAMBIT_STATUSES.shielded.magnitude))));
  });
  it("the shield lasts the round only", () => {
    expect(FALL_BACK_SHIELD_ROUNDS).toBe(1);
  });
});

describe("OC-F9 some enemies cause Corroded", () => {
  it("every caster carries it after its own affliction; nothing else changes", () => {
    const guard = [fighter({ id: "enemy-caster-1", side: "enemy", role: "caster", statusOnHit: { id: "poison", permille: 600 } }), fighter({ id: "enemy-bruiser-1", side: "enemy", role: "bruiser" })];
    withCorrodingCasters(guard);
    expect(guard[0].statusOnHit).toEqual({ id: "poison", permille: 600 });
    expect(guard[0].onHitStatuses).toEqual([{ id: "corroded", permille: CASTER_CORRODE_PERMILLE }]);
    expect(guard[1].onHitStatuses).toBeUndefined();
  });
  it("only on a stamped run, never on a training run", () => {
    const task = { id: "t", poiId: "xenoFloraBloom", fightCount: 0, pointsCleared: 0 };
    const casterOf = (exp: Parameters<typeof taskFightGuard>[0]) => taskFightGuard(exp, { hazard: 0.3 }, task, 1).find((e) => e.role === "caster")!;
    expect(casterOf({ hazardResist: 0, awayRules: 1 }).onHitStatuses).toEqual([{ id: "corroded", permille: CASTER_CORRODE_PERMILLE }]);
    expect(casterOf({ hazardResist: 0 }).onHitStatuses).toBeUndefined();
    expect(casterOf({ hazardResist: 0, awayRules: 1, difficulty: { firstRun: true } } as Parameters<typeof taskFightGuard>[0]).onHitStatuses).toBeUndefined();
  });
  it("a caster's landed hit Corrodes a member, cutting its armor", () => {
    const team = [fighter({ id: "a-m", side: "team", role: "security", memberId: "m", program: [], hp: 400, hpMax: 400, armor: 6 })];
    const enemies = withCorrodingCasters([fighter({ id: "enemy-caster-1", side: "enemy", role: "caster", power: 5 })]);
    enemies[0].onHitStatuses = [{ id: "corroded", permille: 1000 }];
    const log: GambitLogEvent[] = [];
    resolveGroundBattle(team, enemies, 0, makeRng(4), log, 0x99, undefined, true);
    expect(log.some((e) => e.side === "enemy" && e.statusApplied)).toBe(true);
  });
});

describe("OC-F7 rank boosts fieldwork", () => {
  it("a stamped run's Science member's own fieldwork is x its rank factor; an unstamped run's is not", () => {
    const { exp } = wr10Dispatch(0x1234);
    const off = withWr10Off(() => wr10Dispatch(0x1234).exp);
    const member = exp.roster!.science.find((m) => m.memberId === WR10_SCIENCE)!;
    expect(member.rankFactor).toBeCloseTo(1.35, 12);
    expect(memberFieldworkFactor(exp, member, 1)).toBeCloseTo(1.35, 12);
    expect(memberFieldworkFactor(off, member, 1)).toBe(1);
    const on = memberFieldworkTotal(exp, "arid");
    const before = memberFieldworkTotal(off, "arid");
    expect(before).toBeGreaterThan(0);
    expect(on).toBeCloseTo(before * 1.35, 12);
    expect(fieldworkSpeedMult(exp, "arid")).toBeGreaterThan(fieldworkSpeedMult(off, "arid"));
    expect(fieldworkEffect(exp, "arid", "mineralOutcrop").yieldMult).toBeGreaterThan(fieldworkEffect(off, "arid", "mineralOutcrop").yieldMult);
  });
  it("a rank 1 member (factor 1) and a bad factor change nothing", () => {
    expect(memberFieldworkFactor({ awayRules: 1 }, { rankFactor: 1 }, 1.2)).toBe(1.2);
    expect(memberFieldworkFactor({ awayRules: 1 }, { rankFactor: Number.NaN }, 1)).toBe(1);
  });
});

describe("OC-F12 account-wide defaults for new hires", () => {
  it("a Security hire starts with the account program the player changed; a Science hire and a fresh pair change nothing", () => {
    const custom = wr10Hires(true);
    const decapitate = gambitPresetPrograms("decapitate")!.security;
    const sec = custom.awayMembers.find((m) => m.teamType === "security")!;
    const sci = custom.awayMembers.find((m) => m.teamType === "science")!;
    expect(sec.gambit).toEqual(decapitate);
    expect(sec.gambit).not.toBe(custom.gambitPrograms.security);
    expect(sci.gambit).toBeUndefined();
    for (const m of wr10Hires(false).awayMembers) expect(m.gambit).toBeUndefined();
  });
  it("the fresh default pair (Balanced) is no account default: hires keep the built-in program", () => {
    expect(accountProgramForHire({ gambitPrograms: DEFAULT_GAMBIT_PROGRAMS }, "security")).toBeUndefined();
    expect(accountProgramForHire(freshState(), "security")).toBeUndefined();
    expect(withWr10Off(() => accountProgramForHire({ gambitPrograms: { security: [], science: [] } }, "security"))).toBeUndefined();
    expect(accountProgramForHire({ gambitPrograms: { security: [], science: [] } }, "security")).toEqual([]);
  });
});

describe("WR-10 determinism", () => {
  it("one call == 997 s chunks == 1 s steps on a stamped run", () => {
    const { exp } = wr10Dispatch(0x3c3c);
    expect(exp.awayRules).toBe(1);
    const end = 2_000_000;
    const one = advanceExpedition(exp, end);
    expect(one.phase).toBe("complete");
    let chunks = exp;
    for (let t = exp.phaseAnchorSeconds + 997; t < 200_000; t += 997) chunks = advanceExpedition(chunks, t);
    expect(advanceExpedition(chunks, end)).toEqual(one);
    const from = one.groundOps?.startedAt ?? exp.phaseAnchorSeconds;
    let ones = advanceExpedition(exp, from);
    for (let t = from + 1; t <= from + 6_000; t += 1) ones = advanceExpedition(ones, t);
    expect(ones).toEqual(advanceExpedition(exp, from + 6_000));
    expect(advanceExpedition(ones, end)).toEqual(one);
  });
});
