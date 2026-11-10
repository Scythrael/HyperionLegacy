// Wiring WR-10 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-10, USER ANSWERS 2026-10-15 OC-F):
// each answered lever acts as answered, only on a run stamped with the away rules, and the determinism holds.

import { describe, expect, it } from "vitest";
import {
  GAMBIT_STATUSES,
  FALL_BACK_SHIELD_ROUNDS,
  QUICK_DRAW_SHRUG_ROUND,
  SUPPRESS_LINGER_EXTRA_ROUNDS,
  applyStatus,
  buildRosterCombatants,
  effectiveArmor,
  evaluateAndAct,
  resolveGroundBattle,
  type GambitLogEvent,
  type GroundCombatant,
} from "./gambit";
import { CASTER_CORRODE_PERMILLE, casterCorrodePermille, taskFightGuard, withCorrodingCasters } from "./groundFight";
import { rampFraction, rampOddsFraction, rampedChance } from "./runDifficulty";
import { STUDY_BASE_SECONDS, STUDY_MIN_SECONDS, studySeconds } from "./gasGiantStudy";
import { awayTraitEffectText } from "./awayTraits";
import { mergeWithBuiltInDefault } from "./memberGambits";
import { CORRODE_RAMP_TEXT, FIELD_KITS_PARAGRAPHS, GAS_GIANT_PARAGRAPHS, SECURITY_IN_A_FIGHT_PARAGRAPH } from "../helpTopics";
import { ACCOUNT_PAIR_NOTICE, FALL_BACK_HINT, SUPPRESS_HINT, ruleHints } from "../gambitEditorDisplay";
import { fieldworkEffect, fieldworkSpeedMult, memberFieldworkFactor, memberFieldworkTotal } from "./fieldwork";
import { advanceExpedition } from "./expedition";
import { makeRng } from "./combat/rng";
import { accountProgramForHire } from "./awayTeam";
import { DEFAULT_GAMBIT_PROGRAMS, FIELD_KITS_DEFAULT_MEMBER_GAMBIT, freshState, type GambitProgram } from "./model";
import { gambitPresetPrograms } from "./gambit";
import { WR10_SCIENCE, wr10Dispatch, wr10Hires } from "./wr10.fixture";
import { withWr10Off } from "./wr10Switch.fixture";

// The fixture run's gas giant study (seconds), with WR-10 on and off: the rank 8 Science member's own fieldwork counts x1.35.
const STUDY_PINS = { on: 1592, off: 1640 };

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
    // One caster turn (it attacks; the member holds), so the status the hit left is still on the member.
    const member = fighter({ id: "a-m", side: "team", role: "security", memberId: "m", program: [], hp: 400, hpMax: 400, armor: 6 });
    const caster = withCorrodingCasters([fighter({ id: "enemy-caster-1", side: "enemy", role: "caster", power: 30 })], 1000)[0];
    const state = { combatants: [member, caster], round: 0, teamKit: 0, tauntedBy: null, awayRules: true as const };
    evaluateAndAct([{ target: "foeNearest", action: "attack" }], caster, state, makeRng(4));
    expect(member.hp).toBeLessThan(400);
    expect(member.statuses.map((x) => x.id)).toEqual(["corroded"]);
    // The armor cut acts: the member's armor is halved, and the same hit lands harder on a Corroded member.
    expect(effectiveArmor(member)).toBe(6 * (1 - GAMBIT_STATUSES.corroded.magnitude));
    const hitOn = (corroded: boolean): number => {
      const target = fighter({ id: "a-m", side: "team", role: "security", memberId: "m", program: [], hp: 400, hpMax: 400, armor: 6 });
      if (corroded) applyStatus(target, "corroded");
      const foe = fighter({ id: "enemy-caster-1", side: "enemy", role: "caster", power: 30 });
      evaluateAndAct([{ target: "foeNearest", action: "attack" }], foe, { combatants: [target, foe], round: 0, teamKit: 0, tauntedBy: null }, makeRng(4));
      return 400 - target.hp;
    };
    expect(hitOn(true)).toBe(hitOn(false) + 6 * GAMBIT_STATUSES.corroded.magnitude);
  });
});

describe("OC-F9 fix round: the Corroded chance scales with the ramp (user 2026-11-10)", () => {
  const task = { id: "t", poiId: "xenoFloraBloom", fightCount: 0, pointsCleared: 0 };
  const stamped = (completed: number, tier = 1) => ({
    hazardResist: 0,
    awayRules: 1 as const,
    difficulty: { version: 1, firstRun: false, ramp: rampFraction(completed), tier, oddsRamp: rampOddsFraction(completed) },
  });
  const corrodeOf = (exp: object): number =>
    taskFightGuard(exp as Parameters<typeof taskFightGuard>[0], { hazard: 0.3 }, task, 1)
      .find((e) => e.role === "caster")!
      .onHitStatuses?.find((x) => x.id === "corroded")?.permille ?? 0;
  it("the same mechanism as affixes and ambushes: rampedChance at the odds ramp, exactly 30% at the top", () => {
    expect(CASTER_CORRODE_PERMILLE).toBe(300);
    expect(casterCorrodePermille(1)).toBe(300);
    expect(casterCorrodePermille(0)).toBe(0);
    for (const c of [0, 1, 2, 4, 7, 9, 10, 11, 20]) expect(casterCorrodePermille(rampOddsFraction(c)), `completed ${c}`).toBe(Math.round(rampedChance(300, rampOddsFraction(c))));
  });
  it("pins: early, middle and top of the ramp (completed runs after the training run)", () => {
    const pins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => corrodeOf(stamped(c)));
    expect(pins).toEqual([0, 0, 11, 31, 58, 89, 124, 163, 206, 237, 269, 300]);
    // Tier II and up read full strength from the first run (the tier is the step), as an unstamped run does.
    expect(corrodeOf({ hazardResist: 0, awayRules: 1, difficulty: { version: 1, firstRun: false, ramp: 1, tier: 2 } })).toBe(300);
    expect(corrodeOf({ hazardResist: 0, awayRules: 1 })).toBe(300);
  });
  it("at 0 the caster carries no Corroded and draws no roll; never on a training run", () => {
    const caster = taskFightGuard(stamped(0) as Parameters<typeof taskFightGuard>[0], { hazard: 0.3 }, task, 1).find((e) => e.role === "caster")!;
    expect(caster.onHitStatuses).toBeUndefined();
    expect(withCorrodingCasters([fighter({ id: "c", side: "enemy", role: "caster" })], 0)[0].onHitStatuses).toBeUndefined();
    expect(corrodeOf({ hazardResist: 0, awayRules: 1, difficulty: { firstRun: true } })).toBe(0);
  });
  it("Help states the scaled chance from the engine", () => {
    expect(CORRODE_RAMP_TEXT).toContain(`${casterCorrodePermille(rampOddsFraction(4)) / 10}%`);
    expect(CORRODE_RAMP_TEXT).toContain("30%");
    expect(CORRODE_RAMP_TEXT).toContain("0% on the first run after the training run");
    expect(FIELD_KITS_PARAGRAPHS.join(" ")).toContain(CORRODE_RAMP_TEXT);
  });
});

describe("OC-F4 fix round: status chance makes a Suppress last longer (user 2026-11-10)", () => {
  const suppressOnce = (linger: number | undefined, awayRules: boolean, seed: number) => {
    const actor = fighter({ id: "a-s", side: "team", role: "security", memberId: "s", ...(linger !== undefined ? { suppressLinger: linger } : {}) });
    const foe = fighter({ id: "e-1", side: "enemy", role: "bruiser", hp: 9999, hpMax: 9999 });
    const state = { combatants: [actor, foe], round: 0, teamKit: 0, tauntedBy: null, ...(awayRules ? { awayRules: true as const, lingerSeed: seed } : {}) };
    const rng = makeRng(seed);
    evaluateAndAct([{ target: "foeNearest", action: "suppress" }], actor, state, rng);
    return { rounds: foe.statuses.find((x) => x.id === "suppressed")?.remaining ?? 0, next: rng.nextInt(1_000_000) };
  };
  const base = GAMBIT_STATUSES.suppressed.duration;
  it("Suppress still always lands; a sure status chance stretches it one round, only under the away rules", () => {
    expect(SUPPRESS_LINGER_EXTRA_ROUNDS).toBe(1);
    expect(suppressOnce(undefined, true, 1).rounds).toBe(base);
    expect(suppressOnce(1000, true, 1).rounds).toBe(base + 1);
    expect(suppressOnce(1000, false, 1).rounds).toBe(base);
  });
  it("the linger roll is on its own stream: the fight stream draws exactly as without it", () => {
    for (let seed = 1; seed <= 20; seed += 1) expect(suppressOnce(1000, true, seed).next).toBe(suppressOnce(undefined, true, seed).next);
  });
  it("a partial chance lands about that often over many seeds, the same every time", () => {
    const n = 400;
    const extras = Array.from({ length: n }, (_, seed) => suppressOnce(200, true, seed).rounds - base);
    expect(Array.from({ length: n }, (_, seed) => suppressOnce(200, true, seed).rounds - base)).toEqual(extras);
    const share = extras.reduce((a, b) => a + b, 0) / n;
    expect(share).toBeGreaterThan(0.12);
    expect(share).toBeLessThan(0.28);
  });
  it("the roster builder carries the member's status chance (Saboteur: +10%)", () => {
    const { exp } = wr10Dispatch(0x1234);
    const m = exp.roster!.security[0];
    const plain = buildRosterCombatants([{ ...m, groundStats: {} }], 0, "x")[0];
    const sab = buildRosterCombatants([{ ...m, groundStats: { statusChance: 0.1 } }], 0, "x")[0];
    expect(plain.suppressLinger).toBe(m.spec === "debuff" ? 100 : undefined);
    expect(sab.suppressLinger).toBe((plain.suppressLinger ?? 0) + 100);
  });
});

describe("OC-F5 fix round: Quick Draw shrugs off Stun and Fear once (user 2026-11-10)", () => {
  const fight = (status: "stun" | "fear", awayRules: boolean, firstStrike = true, seed = 5): number[] => {
    const member = fighter({ id: "a-q", side: "team", role: "security", memberId: "q", firstStrike, program: [{ target: "foeNearest", action: "attack" }] });
    applyStatus(member, status, undefined, 3);
    const foe = fighter({ id: "e-1", side: "enemy", role: "bruiser", power: 1, hp: 9999, hpMax: 9999, program: [] });
    const log: GambitLogEvent[] = [];
    resolveGroundBattle([member], [foe], 0, makeRng(seed), log, 0x77, undefined, awayRules);
    return [1, 2, 3].map((r) => log.filter((e) => e.round === r && e.memberId === "q" && e.action === "attack").length);
  };
  it("Stun: under the away rules the member acts on their first turn after the enemies have acted (round 2) only", () => {
    expect(QUICK_DRAW_SHRUG_ROUND).toBe(1);
    expect(fight("stun", true)).toEqual([0, 1, 0]);
    expect(fight("stun", false)).toEqual([0, 0, 0]);
    expect(fight("stun", true, false)).toEqual([0, 0, 0]);
  });
  it("Fear: ignored in round 2 only, under the away rules (no Fear roll that turn)", () => {
    const seeds = Array.from({ length: 30 }, (_, i) => i + 1);
    const on = seeds.map((seed) => fight("fear", true, true, seed));
    const off = seeds.map((seed) => fight("fear", false, true, seed));
    const plain = seeds.map((seed) => fight("fear", true, false, seed));
    // Round 2: the Quick Draw member always acts under the away rules; Fear holds them back on some seeds otherwise.
    expect(on.every((r) => r[1] === 1)).toBe(true);
    expect(off.some((r) => r[1] === 0)).toBe(true);
    expect(plain.some((r) => r[1] === 0)).toBe(true);
    // Rounds 1 and 3 are the usual Fear rolls (the shrug is once).
    expect(on.some((r) => r[0] === 0)).toBe(true);
    expect(on.some((r) => r[2] === 0)).toBe(true);
  });
  it("the ability text says exactly that", () => {
    expect(awayTraitEffectText({ kind: "firstStrike" })).toBe("Acts first on the opening round, and ignores Stun and Fear on their first turn after the enemies have acted");
  });
});

describe("Fall Back and Suppress are described in the editor and in Help", () => {
  it("the rule hints and the Help paragraph name their effects", () => {
    expect(ruleHints({ target: "self", action: "fallBack" }, { medic: false, grenade: null }, false)).toEqual([FALL_BACK_HINT]);
    expect(ruleHints({ target: "foeNearest", action: "suppress" }, { medic: false, grenade: null }, true)).toEqual([SUPPRESS_HINT]);
    expect(FALL_BACK_HINT).toContain("Shielded");
    expect(FALL_BACK_HINT).toContain("40% less damage taken");
    expect(SECURITY_IN_A_FIGHT_PARAGRAPH).toContain(FALL_BACK_HINT);
    expect(SECURITY_IN_A_FIGHT_PARAGRAPH).toContain(SUPPRESS_HINT);
    expect(SECURITY_IN_A_FIGHT_PARAGRAPH).toContain("ignores Stun and Fear");
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
  it("a gas giant study is fieldwork: the rank factor speeds it too (pinned, traced through the switch)", () => {
    const { exp } = wr10Dispatch(0x1234);
    const off = withWr10Off(() => wr10Dispatch(0x1234).exp);
    const giant = { planetType: "gasGiant" as const };
    const on = studySeconds(exp, giant);
    const before = studySeconds(off, giant);
    expect([on, before]).toEqual([STUDY_PINS.on, STUDY_PINS.off]);
    expect(on).toBeLessThan(before);
    expect(on).toBe(Math.max(STUDY_MIN_SECONDS, Math.round(STUDY_BASE_SECONDS / fieldworkSpeedMult(exp, "gasGiant"))));
    // Help says so.
    expect(GAS_GIANT_PARAGRAPHS.join(" ")).toContain("counts a little more at a higher rank");
  });
  it("a rank 1 member (factor 1) and a bad factor change nothing", () => {
    expect(memberFieldworkFactor({ awayRules: 1 }, { rankFactor: 1 }, 1.2)).toBe(1.2);
    expect(memberFieldworkFactor({ awayRules: 1 }, { rankFactor: Number.NaN }, 1)).toBe(1);
  });
});

describe("OC-F12 account-wide defaults for new hires", () => {
  it("a Security hire starts with the account program the player changed, merged; a Science hire and a fresh pair change nothing", () => {
    const custom = wr10Hires(true);
    const decapitate = gambitPresetPrograms("decapitate")!.security;
    const sec = custom.awayMembers.find((m) => m.teamType === "security")!;
    const sci = custom.awayMembers.find((m) => m.teamType === "science")!;
    // The fix round (user 2026-11-10 "Merge with built-in"): the built-in support rules the copy lacks, ahead of the
    // player's rules, which follow in their own order.
    const support = FIELD_KITS_DEFAULT_MEMBER_GAMBIT.filter((r) => ["cure", "aidHeal", "brace", "throwGrenade"].includes(r.action));
    expect(sec.gambit).toEqual([...support, ...decapitate]);
    expect(sec.gambit!.map((r) => r.action)).toEqual(["cure", "aidHeal", "brace", "throwGrenade", "throwGrenade", "attack", "attack", "attack", "attack"]);
    expect(sec.gambit).not.toBe(custom.gambitPrograms.security);
    expect(sci.gambit).toBeUndefined();
    for (const m of wr10Hires(false).awayMembers) expect(m.gambit).toBeUndefined();
  });
  it("the fresh default pair (Balanced) is no account default: hires keep the built-in program", () => {
    expect(accountProgramForHire({ gambitPrograms: DEFAULT_GAMBIT_PROGRAMS }, "security")).toBeUndefined();
    expect(accountProgramForHire(freshState(), "security")).toBeUndefined();
    expect(withWr10Off(() => accountProgramForHire({ gambitPrograms: { security: [], science: [] } }, "security"))).toBeUndefined();
    // A changed (empty) program gets the built-in support rules alone.
    expect(accountProgramForHire({ gambitPrograms: { security: [], science: [] } }, "security")!.map((r) => r.action)).toEqual(["cure", "aidHeal", "brace", "throwGrenade", "throwGrenade"]);
  });
  it("the merge order: a kind the player's program already has is theirs and never added twice", () => {
    const own: GambitProgram = [
      { target: "selfHpBelow", params: { hpThreshold: 0.5 }, action: "brace" },
      { target: "foeNearest", action: "attack" },
    ];
    const merged = mergeWithBuiltInDefault(own, true);
    expect(merged.map((r) => r.action)).toEqual(["cure", "aidHeal", "throwGrenade", "throwGrenade", "brace", "attack"]);
    expect(merged.slice(-2)).toEqual(own);
    expect(own).toHaveLength(2);
    // Before kits are live in runs the built-in default is D19's, with no grenade rules.
    expect(mergeWithBuiltInDefault(own, false).map((r) => r.action)).toEqual(["cure", "aidHeal", "brace", "attack"]);
    expect(ACCOUNT_PAIR_NOTICE).toContain("placed ahead of your rules");
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
