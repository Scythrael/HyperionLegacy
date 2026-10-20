// Field Kits FKR-6 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-6): KITS IN BATTLE, the RANK
// CONDITIONS and the BOSS RESERVE, behind flag 2 (Expedition.fieldKits; FKR-7 stamps it at dispatch and passes each
// member's packs, so these tests stamp both by hand). A run without the flag fights byte-identically (FKR-0 / FK-3 pin
// it; fieldKitsBattleGoldens.test.ts pins the stamped fights FKR-6 keeps and names the two it moves).
//
// Covered: each kit's effect and gate (FK2, group 5, D20, N8), free basics before extras, the kit-less Use Item (call
// 15), "Ally downed" and the Injury Kit, the look-past, the rank conditions ("target is Elite or stronger", "target is a
// Boss"), "keep N for a Boss" on grenades and kits, the Field Kits default program (N15), the splinted Fracture's bay
// time (call 18), the fight record, the threat samples spending supplies (FK12), and offline == live.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_GAMBIT,
  FIELD_KITS_DEFAULT_GRENADE_RULES,
  FIELD_KITS_DEFAULT_MEMBER_GAMBIT,
  FIELD_KITS_PLAYER_LIVE,
  freshState,
  type AwayMember,
  type BodyRiskGrades,
  type EnemyRank,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionBody,
  type GambitProgram,
  type GambitRule,
  type GameState,
  type ShipGroundTeam,
} from "./model";
import {
  GAMBIT_PRESETS,
  applyBoneHit,
  applyStatus,
  evaluateAndAct,
  kitsHeld,
  resolveGroundBattle,
  spendKit,
  type BattleState,
  type CombatantKits,
  type GroundCombatant,
} from "./gambit";
import { FIELD_KITS_CATALOG_VERSION, SPLINT_HEAL_ROUNDS, INJURY_KIT_TREATMENT_SHARE, STIM_INSPIRED_ROUNDS, type FieldKitId } from "./fieldKits";
import { FIELD_KITS_BATTLE, LEGACY_USE_ITEM_KIT, fightSuppliesAfter, kitUsable, withFieldKitPacks, withFieldKitsDefaultProgram } from "./fieldKitsBattle";
import { memberEndConditions, resolveTaskFight, taskFightTeam, type GroundFightTeam } from "./groundFight";
import { groundThreatOddsKey, groundThreatSampleFights } from "./groundThreat";
import { advanceExpedition, startExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { gambitRuleEquals } from "./memberGambits";
import { makeRng } from "./combat/rng";
import { plainAwayMember, withoutFieldKits } from "./awayTeamTestFixtures";

const KITS = { catalog: FIELD_KITS_CATALOG_VERSION };

// ===== fixtures =====

function gc(id: string, side: "team" | "enemy", over: Partial<GroundCombatant> = {}): GroundCombatant {
  return {
    id,
    side,
    role: side === "team" ? "security" : "bruiser",
    hp: 100,
    hpMax: 100,
    power: 12,
    accuracy: 1,
    armor: 0,
    heal: 0,
    threat: 12,
    groupTag: side === "team" ? "team" : "a",
    statuses: [],
    downed: false,
    ...over,
  };
}

// A Field Kits battle (the kit rules injected) and a member's pack.
function kitBattle(combatants: GroundCombatant[]): BattleState {
  return { combatants, round: 0, teamKit: 5, tauntedBy: null, kitRules: FIELD_KITS_BATTLE };
}
function pack(extras: Partial<Record<FieldKitId, number>> = {}, basics: Partial<Record<FieldKitId, number>> = {}): CombatantKits {
  return { basics: { ...basics }, extras: { ...extras }, basicsUsed: {}, extrasUsed: {} };
}
const use = (kitId?: FieldKitId, target: GambitRule["target"] = "allyHasStatus", over: Partial<GambitRule["params"]> = {}): GambitRule => ({
  target,
  params: { ...(kitId ? { kitId } : {}), ...over },
  action: "useItem",
});
// Evaluate `program` for `actor` once; the program's last rule is a Hold marker, so a skipped kit rule shows as a hold.
function act(program: GambitProgram, actor: GroundCombatant, st: BattleState): string {
  st.log = [];
  evaluateAndAct(program, actor, st, makeRng(7));
  return st.log[0].action;
}
const ids = (c: GroundCombatant) => c.statuses.map((s) => s.id).sort();

// ===== kits in battle =====

describe("kits in battle: the actor spends its OWN kits, a free basic first (FK4, group 7)", () => {
  it("one use spends a basic before an extra, and only the rule's kit", () => {
    const actor = gc("a1", "team", { kits: pack({ firstAidKit: 1 }, { firstAidKit: 1 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "weakened");
    const st = kitBattle([actor, ally, gc("e1", "enemy")]);
    expect(act([use("firstAidKit")], actor, st)).toBe("useItem");
    expect(actor.kits).toMatchObject({ basics: { firstAidKit: 0 }, extras: { firstAidKit: 1 }, basicsUsed: { firstAidKit: 1 }, extrasUsed: {} });
    applyStatus(ally, "weakened");
    act([use("firstAidKit")], actor, st);
    expect(actor.kits).toMatchObject({ extras: { firstAidKit: 0 }, extrasUsed: { firstAidKit: 1 } });
    expect(st.teamKit).toBe(5); // the team kit is never read on a Field Kits run
    expect(kitsHeld(actor.kits, "firstAidKit")).toBe(0);
  });

  it("no kit left, or none packed: the rule does not fire and the next one acts", () => {
    const actor = gc("a1", "team", { kits: pack({ antitoxin: 3 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "weakened");
    expect(act([use("firstAidKit"), { target: "self", action: "hold" }], actor, kitBattle([actor, ally, gc("e1", "enemy")]))).toBe("hold");
    const empty = { basics: {}, extras: {}, basicsUsed: {}, extrasUsed: {} };
    expect(spendKit(empty, "firstAidKit")).toBe(false);
  });

  it("a kit-less Use Item means the First Aid Kit (call 15) and spends no team kit", () => {
    expect(LEGACY_USE_ITEM_KIT).toBe("firstAidKit");
    const actor = gc("a1", "team", { kits: pack({ firstAidKit: 1 }) });
    const ally = gc("a2", "team", { hp: 50 });
    applyStatus(ally, "bleed");
    const st = kitBattle([actor, ally, gc("e1", "enemy")]);
    expect(act([{ target: "allyHasStatus", action: "useItem" }], actor, st)).toBe("useItem");
    expect(actor.kits!.extrasUsed).toEqual({ firstAidKit: 1 });
    expect(st.teamKit).toBe(5);
  });

  it("a battle without the kit rules (every run without Field Kits) keeps the team kit, kits or not", () => {
    const actor = gc("a1", "team", { kits: pack({ firstAidKit: 1 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "poison");
    const st: BattleState = { combatants: [actor, ally, gc("e1", "enemy")], round: 0, teamKit: 2, tauntedBy: null };
    evaluateAndAct([{ target: "allyHasStatus", params: { kitId: "splint" }, action: "useItem" }], actor, st, makeRng(7));
    expect(st.teamKit).toBe(1);
    expect(actor.kits!.extrasUsed).toEqual({});
  });
});

describe("each kit's effect (group 5 coverage, FK13 numbers, D20 gates)", () => {
  it("First Aid Kit: the basic list but never Poison or a serious condition; 0.5x untrained, 1.25x trained; the heal rides the cleanse", () => {
    const untrained = gc("a1", "team", { kits: pack({ firstAidKit: 9 }) });
    const ally = gc("a2", "team", { hp: 50 });
    applyStatus(ally, "weakened"); // 3 rounds
    applyStatus(ally, "poison");
    applyStatus(ally, "hemorrhage");
    const st = kitBattle([untrained, ally, gc("e1", "enemy")]);
    act([use("firstAidKit")], untrained, st);
    expect(ally.statuses.find((s) => s.id === "weakened")!.remaining).toBe(1); // 3 - ceil(1.5)
    expect(ally.hp).toBe(55); // round(10 x 0.5)
    expect(ids(ally)).toEqual(["hemorrhage", "poison", "weakened"]);
    const medic = gc("a3", "team", { medic: true, kits: pack({ firstAidKit: 1 }) });
    st.combatants.push(medic);
    act([use("firstAidKit")], medic, st);
    expect(ids(ally)).toEqual(["hemorrhage", "poison"]);
    expect(ally.hp).toBe(55 + 13); // round(10 x 1.25)
    // Nothing left on its list: the next First Aid Kit does not fire.
    expect(act([use("firstAidKit"), { target: "self", action: "hold" }], medic, st)).toBe("hold");
  });

  it("Fleet Triage scales First Aid kits (careMult), not Advanced Medical", () => {
    const triaged = gc("a1", "team", { careMult: 2, kits: pack({ firstAidKit: 1 }) });
    const ally = gc("a2", "team", { hp: 50 });
    applyStatus(ally, "weakened");
    act([use("firstAidKit")], triaged, kitBattle([triaged, ally, gc("e1", "enemy")]));
    expect(ally.hp).toBe(60);
  });

  it("Antitoxin: Poison only", () => {
    const medic = gc("a1", "team", { medic: true, kits: pack({ antitoxin: 2 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "neurotoxin");
    const st = kitBattle([medic, ally, gc("e1", "enemy")]);
    expect(act([use("antitoxin"), { target: "self", action: "hold" }], medic, st)).toBe("hold");
    applyStatus(ally, "poison");
    act([use("antitoxin")], medic, st);
    expect(ids(ally)).toEqual(["neurotoxin"]);
  });

  it("Combat Stim: Inspired for 2 rounds x the effectiveness (at least 1), only on an ally without it", () => {
    const actor = gc("a1", "team", { kits: pack({ combatStim: 3 }) });
    const st = kitBattle([actor, gc("e1", "enemy")]);
    act([use("combatStim", "self")], actor, st);
    expect(actor.statuses).toEqual([{ id: "inspired", magnitude: 0.3, remaining: Math.max(1, Math.round(STIM_INSPIRED_ROUNDS * 0.5)) }]);
    expect(act([use("combatStim", "self"), { target: "self", action: "hold" }], actor, st)).toBe("hold");
    const medic = gc("a2", "team", { medic: true, kits: pack({ combatStim: 1 }) });
    act([use("combatStim", "self")], medic, kitBattle([medic, gc("e1", "enemy")]));
    expect(medic.statuses[0].remaining).toBe(Math.round(STIM_INSPIRED_ROUNDS * 1.25));
    // A foe is never a kit's target.
    const foeRule = use("combatStim", "foeNearest");
    expect(act([foeRule, { target: "self", action: "hold" }], gc("a3", "team", { kits: pack({ combatStim: 1 }) }), kitBattle([gc("a3", "team"), gc("e1", "enemy")]))).toBe("hold");
  });

  it("Splint (Medical Training): a Fracture heals in 3 rounds, a Broken Bone becomes a Fracture (N8), never a Shattered Bone", () => {
    const medic = gc("a1", "team", { medic: true, kits: pack({ splint: 5 }) });
    const ally = gc("a2", "team");
    applyBoneHit(ally);
    applyBoneHit(ally); // Broken Bone
    const st = kitBattle([medic, ally, gc("e1", "enemy")]);
    act([use("splint")], medic, st);
    expect(ids(ally)).toEqual(["fracture"]);
    expect(ally.statuses[0].remaining).toBeGreaterThan(SPLINT_HEAL_ROUNDS);
    act([use("splint")], medic, st);
    expect(ally.statuses).toEqual([{ id: "fracture", magnitude: 0.2, remaining: SPLINT_HEAL_ROUNDS }]);
    // Already splinted: no second Splint.
    expect(act([use("splint"), { target: "self", action: "hold" }], medic, st)).toBe("hold");
    const shattered = gc("a3", "team");
    applyBoneHit(shattered);
    applyBoneHit(shattered);
    applyBoneHit(shattered);
    expect(kitUsable("splint", medic, shattered)).toBe(false);
    expect(kitUsable("traumaKit", medic, shattered)).toBe(false);
  });

  it("Trauma Kit (Medical Training): one use clears Hemorrhage, Neurotoxin, Concussion and a bone up to Broken Bone", () => {
    const medic = gc("a1", "team", { medic: true, kits: pack({ traumaKit: 1 }) });
    const ally = gc("a2", "team");
    for (const id of ["hemorrhage", "neurotoxin", "concussion", "weakened"] as const) applyStatus(ally, id);
    applyBoneHit(ally);
    applyBoneHit(ally);
    act([use("traumaKit")], medic, kitBattle([medic, ally, gc("e1", "enemy")]));
    expect(ids(ally)).toEqual(["weakened"]);
  });

  it("a rule naming a status treats only that one", () => {
    const medic = gc("a1", "team", { medic: true, kits: pack({ traumaKit: 1 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "hemorrhage");
    applyStatus(ally, "concussion");
    act([use("traumaKit", "allyHasStatus", { statusId: "concussion" })], medic, kitBattle([medic, ally, gc("e1", "enemy")]));
    expect(ids(ally)).toEqual(["hemorrhage"]);
  });

  it("Advanced Medical is a hard gate (D20): an untrained member's Splint, Trauma Kit or Injury Kit never fires; the next rule acts", () => {
    const ally = gc("a2", "team");
    applyBoneHit(ally);
    applyStatus(ally, "hemorrhage");
    const downed = gc("a3", "team", { memberId: "m3", hp: 0, downed: true });
    for (const kit of ["splint", "traumaKit", "injuryKit"] as const) {
      const untrained = gc("a1", "team", { kits: pack({ [kit]: 2 }) });
      const st = kitBattle([untrained, ally, downed, gc("e1", "enemy")]);
      expect(act([use(kit, kit === "injuryKit" ? "allyDowned" : "allyHasStatus"), { target: "self", action: "hold" }], untrained, st), kit).toBe("hold");
      expect(untrained.kits!.extrasUsed, kit).toEqual({});
    }
  });

  it("Injury Kit: 'Ally downed' targets a downed member once per battle, recording the bay share; nothing else fires on a downed ally", () => {
    const medic = gc("a1", "team", { medic: true, memberId: "m1", kits: pack({ injuryKit: 3, firstAidKit: 3 }) });
    const d2 = gc("a2", "team", { memberId: "m2", hp: 0, downed: true });
    const d3 = gc("a3", "team", { memberId: "m3", hp: 0, downed: true });
    applyStatus(d2, "poison");
    const st = kitBattle([medic, d2, d3, gc("e1", "enemy")]);
    act([use("injuryKit", "allyDowned")], medic, st);
    act([use("injuryKit", "allyDowned")], medic, st);
    expect(d2.injuryTreated).toBe(INJURY_KIT_TREATMENT_SHARE);
    expect(d3.injuryTreated).toBe(INJURY_KIT_TREATMENT_SHARE); // the look-past: d2 was treated already
    expect(act([use("injuryKit", "allyDowned"), { target: "self", action: "hold" }], medic, st)).toBe("hold");
    for (const action of ["aidHeal", "cure", "attack"] as const) {
      expect(act([{ target: "allyDowned", action }, { target: "self", action: "hold" }], medic, st), action).toBe("hold");
    }
    expect(act([use("firstAidKit", "allyDowned"), { target: "self", action: "hold" }], medic, st)).toBe("hold");
    // A battle without the kit rules never fires "Ally downed" at all.
    const plain: BattleState = { combatants: [medic, d2, gc("e1", "enemy")], round: 0, teamKit: 2, tauntedBy: null };
    plain.log = [];
    evaluateAndAct([{ target: "allyDowned", action: "useItem" }], medic, plain, makeRng(1));
    expect(plain.log[0].action).toBe("hold");
    expect(plain.teamKit).toBe(2);
  });

  it("the look-past: an 'ally has any debuff' kit rule passes over an ally it cannot treat to the most wounded one it can", () => {
    const actor = gc("a1", "team", { kits: pack({ firstAidKit: 1 }) });
    const fractured = gc("a2", "team", { hp: 10 });
    applyBoneHit(fractured);
    const bleeding = gc("a3", "team", { hp: 60 });
    applyStatus(bleeding, "bleed");
    act([use("firstAidKit")], actor, kitBattle([actor, fractured, bleeding, gc("e1", "enemy")]));
    expect(bleeding.statuses).toEqual([{ id: "bleed", magnitude: 7, remaining: 1 }]); // untrained: 3 - ceil(1.5)
    expect(bleeding.hp).toBe(65);
    expect(ids(fractured)).toEqual(["fracture"]);
    expect(fractured.hp).toBe(10);
  });
});

// ===== rank conditions and the Boss reserve =====

describe("rank conditions (group 7: 'target is Elite or stronger', 'target is a Boss')", () => {
  const lineup: EnemyRank[] = ["weak", "normal", "strong", "elite", "boss"];
  const hits = (minRank?: EnemyRank) =>
    lineup.filter((rank) => {
      const actor = gc("a1", "team");
      const foe = gc("e1", "enemy", { rank, hp: 1000, hpMax: 1000 });
      evaluateAndAct([{ target: "foeNearest", ...(minRank ? { params: { minRank } } : {}), action: "attack" }], actor, { combatants: [actor, foe], round: 0, teamKit: 0, tauntedBy: null }, makeRng(3));
      return foe.hp < 1000;
    });
  it("gate any rule on its resolved target; an unranked foe reads Normal", () => {
    expect(hits()).toEqual(lineup);
    expect(hits("elite")).toEqual(["elite", "boss"]);
    expect(hits("boss")).toEqual(["boss"]);
    const actor = gc("a1", "team");
    const st: BattleState = { combatants: [actor, gc("e1", "enemy")], round: 0, teamKit: 0, tauntedBy: null, log: [] };
    evaluateAndAct([{ target: "foeNearest", params: { minRank: "strong" }, action: "attack" }, { target: "self", action: "hold" }], actor, st, makeRng(3));
    expect(st.log![0].action).toBe("hold");
  });
  it("an ally target reads Normal (a kit rule with a rank condition never fires)", () => {
    const actor = gc("a1", "team", { kits: pack({ firstAidKit: 1 }) });
    const ally = gc("a2", "team");
    applyStatus(ally, "weakened");
    expect(act([use("firstAidKit", "allyHasStatus", { minRank: "elite" }), { target: "self", action: "hold" }], actor, kitBattle([actor, ally, gc("e1", "enemy", { rank: "boss" })]))).toBe("hold");
  });
});

describe("'keep N for a Boss' (group 7 reserve; FK11 'save at least one for the final battle')", () => {
  const grenade = (charges: number, used = 0) => ({ status: "concussion" as const, statusPermille: 0, powerMult: 1.5, charges, perBattle: 9, used });
  const throwRule: GambitRule = { target: "foeNearest", params: { reserveForBoss: 1 }, action: "throwGrenade" };
  const fires = (thrower: GroundCombatant, foe: GroundCombatant, rule: GambitRule = throwRule) => {
    const st: BattleState = { combatants: [thrower, foe], round: 0, teamKit: 0, tauntedBy: null, log: [] };
    evaluateAndAct([rule, { target: "self", action: "hold" }], thrower, st, makeRng(5));
    return st.log![0].action === "throwGrenade";
  };
  it("on a target that is not a Boss it fires only while MORE than N charges are left", () => {
    expect(fires(gc("a1", "team", { grenade: grenade(2) }), gc("e1", "enemy"))).toBe(true);
    expect(fires(gc("a1", "team", { grenade: grenade(2, 1) }), gc("e1", "enemy"))).toBe(false);
    expect(fires(gc("a1", "team", { grenade: grenade(2, 1) }), gc("e1", "enemy", { rank: "elite" }))).toBe(false);
    expect(fires(gc("a1", "team", { grenade: grenade(3) }), gc("e1", "enemy"), { ...throwRule, params: { reserveForBoss: 2 } })).toBe(true);
    expect(fires(gc("a1", "team", { grenade: grenade(2) }), gc("e1", "enemy"), { ...throwRule, params: { reserveForBoss: 2 } })).toBe(false);
  });
  it("on a Boss it spends freely; a reserve of 0 (or none) never holds back", () => {
    expect(fires(gc("a1", "team", { grenade: grenade(2, 1) }), gc("e1", "enemy", { rank: "boss" }))).toBe(true);
    expect(fires(gc("a1", "team", { grenade: grenade(1) }), gc("e1", "enemy"), { ...throwRule, params: { reserveForBoss: 0 } })).toBe(true);
  });
  it("a kit rule (aimed at an ally) keeps its reserve unless a Boss stands among the foes [PROPOSAL]", () => {
    const ally = () => {
      const a = gc("a2", "team");
      applyStatus(a, "weakened");
      return a;
    };
    const rule = use("firstAidKit", "allyHasStatus", { reserveForBoss: 1 });
    const one = () => gc("a1", "team", { kits: pack({ firstAidKit: 1 }) });
    expect(act([rule, { target: "self", action: "hold" }], one(), kitBattle([one(), ally(), gc("e1", "enemy")]))).toBe("hold");
    const two = gc("a1", "team", { kits: pack({ firstAidKit: 2 }) });
    expect(act([rule], two, kitBattle([two, ally(), gc("e1", "enemy")]))).toBe("useItem");
    const solo = one();
    expect(act([rule], solo, kitBattle([solo, ally(), gc("e1", "enemy", { rank: "boss" })]))).toBe("useItem");
    // A downed Boss lifts nothing.
    const late = one();
    expect(act([rule, { target: "self", action: "hold" }], late, kitBattle([late, ally(), gc("e1", "enemy", { rank: "boss", hp: 0, downed: true }), gc("e2", "enemy")]))).toBe("hold");
  });
});

// ===== the Field Kits default program (N15) =====

describe("the default program on a Field Kits run (N15: throws, keeping one for a Boss; still no kit use, D19)", () => {
  it("is D19's default with the two grenade rules after its medic and defense rules", () => {
    expect(FIELD_KITS_DEFAULT_MEMBER_GAMBIT.filter((r) => !FIELD_KITS_DEFAULT_GRENADE_RULES.includes(r))).toEqual(DEFAULT_MEMBER_GAMBIT);
    expect(FIELD_KITS_DEFAULT_MEMBER_GAMBIT.slice(3, 5)).toEqual(FIELD_KITS_DEFAULT_GRENADE_RULES);
    expect(FIELD_KITS_DEFAULT_GRENADE_RULES).toEqual([
      { target: "foeHighestThreat", params: { minRank: "boss" }, action: "throwGrenade" },
      { target: "foeLargestGroup", params: { reserveForBoss: 1 }, action: "throwGrenade" },
    ]);
    expect(FIELD_KITS_DEFAULT_MEMBER_GAMBIT.some((r) => r.action === "useItem")).toBe(false);
  });

  it("is swapped in only for a member whose program IS the default", () => {
    const onDefault = gc("a1", "team", { program: DEFAULT_MEMBER_GAMBIT.map((r) => ({ ...r, ...(r.params ? { params: { ...r.params } } : {}) })) });
    const own: GambitProgram = [{ target: "foeNearest", action: "attack" }];
    const custom = gc("a2", "team", { program: own });
    withFieldKitsDefaultProgram([onDefault, custom]);
    expect(onDefault.program).toEqual(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
    expect(onDefault.program).not.toBe(FIELD_KITS_DEFAULT_MEMBER_GAMBIT);
    expect(custom.program).toBe(own);
  });

  it("throws at the largest group while charges are spare, keeps the last one, then throws it at a Boss", () => {
    const thrower = (used: number) => {
      const c = gc("a1", "team", { memberId: "m1", hp: 1e6, hpMax: 1e6, grenade: { status: "concussion", statusPermille: 0, powerMult: 1.5, charges: 2, perBattle: 1, used } });
      c.program = FIELD_KITS_DEFAULT_MEMBER_GAMBIT;
      return c;
    };
    const foes = (lead?: EnemyRank) => [gc("e1", "enemy", { hp: 1e6, hpMax: 1e6, threat: 50, ...(lead ? { rank: lead } : {}) }), gc("e2", "enemy", { hp: 1e6, hpMax: 1e6 })];
    expect(resolveGroundBattle([thrower(0)], foes(), 0, makeRng(9)).chargesUsed).toEqual({ m1: 1 });
    // One charge left: kept against a Normal or an Elite fight, thrown at a Boss.
    const keep = thrower(1);
    keep.grenade = { ...keep.grenade!, charges: 1, used: 0 };
    expect(resolveGroundBattle([keep], foes("elite"), 0, makeRng(9)).chargesUsed).toBeUndefined();
    const boss = thrower(1);
    boss.grenade = { ...boss.grenade!, charges: 1, used: 0 };
    expect(resolveGroundBattle([boss], foes("boss"), 0, makeRng(9)).chargesUsed).toEqual({ m1: 1 });
  });
});

describe("presets and rule equality", () => {
  it("Triage stays the pre-kit program until kits are live (FIELD_KITS_PLAYER_LIVE, FKR-7); its kit rules wait behind the switch", () => {
    const triage = GAMBIT_PRESETS.find((p) => p.id === "triage")!.programs.security;
    expect(FIELD_KITS_PLAYER_LIVE).toBe(false);
    expect(triage.some((r) => r.params?.kitId !== undefined)).toBe(false);
    expect(triage.filter((r) => r.action === "useItem")).toEqual([{ target: "allyHasStatus", action: "useItem" }]);
  });
  it("gambitRuleEquals reads the kit, rank condition and reserve params", () => {
    const r: GambitRule = { target: "foeNearest", action: "throwGrenade" };
    expect(gambitRuleEquals(r, { ...r, params: {} })).toBe(true);
    expect(gambitRuleEquals(r, { ...r, params: { minRank: "boss" } })).toBe(false);
    expect(gambitRuleEquals(r, { ...r, params: { reserveForBoss: 1 } })).toBe(false);
    expect(gambitRuleEquals({ ...r, action: "useItem" }, { ...r, action: "useItem", params: { kitId: "splint" } })).toBe(false);
  });
});

// ===== the bay: a splinted Fracture (call 18) =====

describe("a splinted Fracture costs no Fracture bay time (call 18, 'No Fracture bay time')", () => {
  it("a healing Fracture is no bay condition; an unsplinted one is", () => {
    const c = gc("a1", "team", { hp: 50 });
    applyBoneHit(c);
    expect(memberEndConditions(c)).toEqual(["health", "fracture"]);
    c.statuses[0].remaining = SPLINT_HEAL_ROUNDS;
    expect(memberEndConditions(c)).toEqual(["health"]);
  });
});

// ===== supplies across an objective's fights =====

describe("supplies across an objective's fights (fightSuppliesAfter, FKR-7 reuses it)", () => {
  it("subtracts each member's spends; a team that spent nothing comes back as the same object", () => {
    const team = { securityIds: ["m1", "m2"], basics: { m1: { firstAidKit: 2 } }, kits: { m2: { splint: 1, firstAidKit: 1 } } };
    expect(fightSuppliesAfter(team, {}, [])).toBe(team);
    const after = fightSuppliesAfter(team, { basicsUsed: { m1: { firstAidKit: 1 } }, kitsUsed: { m2: { splint: 1 } } }, []);
    expect(after.basics).toEqual({ m1: { firstAidKit: 1 } });
    expect(after.kits).toEqual({ m2: { splint: 0, firstAidKit: 1 } });
    expect(team.basics.m1.firstAidKit).toBe(2); // never mutated
  });
});

// ===== real runs =====

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

function piece(id: string, variety: string, wearer: string): EquipmentInstance {
  return {
    id,
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: { groundStatusChance: 30 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

// Two ground teams; member-1 and member-4 carry an Impact Grenade; member-3 and member-6 have Medical Training.
function crewed(expeditionSeed: number, program?: GambitProgram): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(teamType === "security" && (id === "member-3" || id === "member-6") ? { traits: ["fieldMedic"] } : {}),
    ...(program && teamType === "security" ? { gambit: program.map((r) => ({ ...r, ...(r.params ? { params: { ...r.params } } : {}) })) } : {}),
  });
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    equipment: [...base.equipment, piece("equip-901", "impactGrenade", "member-1"), piece("equip-902", "impactGrenade", "member-4")],
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function handRun(state: GameState, pois: string[], risk: BodyRiskGrades, kits: boolean, hazard = 0.2): Expedition {
  const res = startExpedition(state, "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = withoutFieldKits(res.expedition);
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard,
    scanned: true,
    discoveries: pois.map((poiId, k) => ({ id: `${d.id}-body-1-disc-${k}`, kind: "landmark", poiId })),
    activities: pois.map((poiId, k) => ({ id: `${d.id}-body-1-act-${k}`, bodyId: "body-1", poiId, done: false })),
    risk: { ...risk },
  };
  const exp: Expedition = structuredClone({
    ...d,
    phase: "activities",
    phaseAnchorSeconds: T0,
    bodies: [body],
    scanStepCursor: Math.max(0, (d.encounterSteps ?? 1) - 1),
    groundOps: { ...d.groundOps!, startedAt: T0 },
    risk: { version: 1, tier: 1, enemyTerritory: false, system: { combat: risk.combat, fauna: risk.fauna, flora: risk.flora }, difficultyTier: 1, affixCatalog: 2 },
    ...(kits ? { fieldKits: KITS } : {}),
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const PACK_ALL = { firstAidKit: 3, antitoxin: 2, splint: 2, traumaKit: 2, combatStim: 1 };
const fightTeamsOf = (exp: Expedition, extra: Partial<GroundFightTeam> = {}): GroundFightTeam[] =>
  exp.groundOps!.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i], ...extra }));
const packsFor = (ids: readonly string[], p: Partial<Record<FieldKitId, number>>) => Object.fromEntries(ids.map((id) => [id, { ...p }]));

const MEDIC_PROGRAM: GambitProgram = [
  { target: "allyHasStatus", params: { kitId: "traumaKit" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "splint" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "antitoxin" }, action: "useItem" },
  { target: "allyHasStatus", params: { kitId: "firstAidKit" }, action: "useItem" },
  { target: "foeLowestHp", action: "execute" },
  { target: "foeNearest", action: "attack" },
];

describe("kits on a real run's fights, behind the flag", () => {
  const plain = handRun(crewed(0x7a11, MEDIC_PROGRAM), ["enemyFortification", "derelictOutpost", "enemyColony"], { ...CALM, combat: 4 }, false, 0.6);
  const exp = { ...plain, fieldKits: KITS };
  const task = (k: number) => ({ ...exp.bodies[0].activities[k], fightCount: 0, pointsCleared: 0 });
  const withPacks = (e: Expedition) => fightTeamsOf(e, { kits: packsFor(SEC, PACK_ALL), basics: packsFor(SEC, { firstAidKit: 1 }) });

  it("the squad carries each member's own pack on a Field Kits run only", () => {
    const team = taskFightTeam(exp, withPacks(exp), { id: "t", fightCount: 0 });
    expect(team.find((c) => c.memberId === "member-2")!.kits).toEqual({ basics: { firstAidKit: 1 }, extras: PACK_ALL, basicsUsed: {}, extrasUsed: {} });
    for (const c of taskFightTeam(plain, withPacks(plain), { id: "t", fightCount: 0 })) expect(c.kits).toBeUndefined();
    // No pack passed: every member carries an empty one.
    expect(taskFightTeam(exp, fightTeamsOf(exp), { id: "t", fightCount: 0 }).every((c) => kitsHeld(c.kits, "firstAidKit") === 0 && c.kits !== undefined)).toBe(true);
  });

  it("a Field Kits fight spends packed kits and records them; the flag-less twin ignores the packs entirely", () => {
    const records = [0, 1, 2].map((k) => resolveTaskFight(exp, withPacks(exp), exp.bodies[0], task(k), k));
    const spent = records.filter((r) => r.basicsUsed !== undefined || r.kitsUsed !== undefined);
    expect(spent.length).toBeGreaterThan(0);
    for (const r of spent) {
      for (const [id, used] of Object.entries({ ...(r.basicsUsed ?? {}), ...(r.kitsUsed ?? {}) })) {
        expect(SEC).toContain(id);
        for (const n of Object.values(used)) expect(n).toBeGreaterThan(0);
      }
      for (const used of Object.values(r.basicsUsed ?? {})) expect(Object.keys(used)).toEqual(["firstAidKit"]);
    }
    for (let k = 0; k < 3; k += 1) {
      const r = resolveTaskFight(plain, withPacks(plain), plain.bodies[0], task(k), k);
      expect(r).toEqual(resolveTaskFight(plain, fightTeamsOf(plain), plain.bodies[0], task(k), k));
      for (const key of ["basicsUsed", "kitsUsed", "treated"]) expect(Object.keys(r)).not.toContain(key);
    }
  });

  it("a stamped fight with no packs and no kit rule equals its FKR-5 self (same program, no kits carried)", () => {
    const noKits = handRun(crewed(0x7a11, [{ target: "foeLowestHp", action: "execute" }, { target: "foeNearest", action: "attack" }]), ["enemyColony"], { ...CALM, combat: 3 }, true);
    const t = { ...noKits.bodies[0].activities[0], fightCount: 0, pointsCleared: 0 };
    const a = resolveTaskFight(noKits, fightTeamsOf(noKits), noKits.bodies[0], t, 0);
    const b = resolveTaskFight(noKits, fightTeamsOf(noKits, { kits: {}, basics: {} }), noKits.bodies[0], t, 0);
    expect(b).toEqual(a);
    for (const key of ["basicsUsed", "kitsUsed", "treated"]) expect(Object.keys(a)).not.toContain(key);
  });

  it("the threat key reads packs on a Field Kits run only; its samples spend supplies fight by fight (FK12)", () => {
    const t = exp.bodies[0].activities[0];
    const k1 = groundThreatOddsKey(exp, withPacks(exp), exp.bodies[0], t, 0, 32);
    expect(groundThreatOddsKey(exp, fightTeamsOf(exp), exp.bodies[0], t, 0, 32)).not.toBe(k1);
    expect(groundThreatOddsKey(plain, withPacks(plain), plain.bodies[0], t, 0, 32)).toBe(groundThreatOddsKey(plain, fightTeamsOf(plain), plain.bodies[0], t, 0, 32));
    // A sample over a multi-fight objective: no fight spends a kit or charge the earlier fights already spent.
    let checked = 0;
    for (let s = 0; s < 8; s += 1) {
      const sample = groundThreatSampleFights(exp, withPacks(exp), exp.bodies[0], { ...t, fightPoints: [0.25, 0.5, 0.75], pointsCleared: 0, fightCount: 0 }, 0, s);
      const total: Record<string, number> = {};
      for (const f of sample.fights) {
        for (const [id, used] of Object.entries(f.kitsUsed ?? {})) for (const [kit, n] of Object.entries(used)) total[`${id}:${kit}`] = (total[`${id}:${kit}`] ?? 0) + (n ?? 0);
        for (const [id, n] of Object.entries(f.chargesUsed ?? {})) total[`${id}:charges`] = (total[`${id}:charges`] ?? 0) + n;
      }
      for (const [key, n] of Object.entries(total)) {
        const [, kit] = key.split(":");
        const cap = kit === "charges" ? 4 : (PACK_ALL as Record<string, number>)[kit];
        expect(n, key).toBeLessThanOrEqual(cap);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a stamped run on the default program (it throws): one call == 997 s chunks == 1 s steps", { timeout: 300_000 }, () => {
    const run = handRun(crewed(0xf0f7), ["enemyFortification", "derelictOutpost"], { ...CALM, combat: 4 }, true);
    const end = T0 + 200_000;
    const one = advanceExpedition(run, end);
    let e = run;
    for (let t = T0 + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(one);
    const H = T0 + 3 * 3600;
    let s = run;
    let threw = false;
    for (let t = T0 + 1; t <= H; t += 1) {
      s = advanceExpedition(s, t);
      threw ||= s.groundOps!.teams.some((team) => team.pendingFight?.chargesUsed !== undefined);
    }
    expect(s).toEqual(advanceExpedition(run, H));
    expect(advanceExpedition(s, end)).toEqual(one);
    expect(threw).toBe(true);
  });
});

describe("withFieldKitPacks reads clean counts only", () => {
  it("drops unknown kits, non-finite and fractional counts", () => {
    const [c] = withFieldKitPacks([gc("a1", "team", { memberId: "m1" })], { m1: { firstAidKit: 2.7, splint: Number.NaN } as never }, { m1: { bogus: 4, antitoxin: -1, traumaKit: 1 } as never });
    expect(c.kits).toEqual({ basics: { firstAidKit: 2 }, extras: { traumaKit: 1 }, basicsUsed: {}, extrasUsed: {} });
  });
});
