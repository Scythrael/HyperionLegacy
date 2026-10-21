// Field Kits FKR-5 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-5): TOOL CHARGES, the +1 CARRY
// CAPACITY line and the GRENADE FAMILY, behind flag 2 (Expedition.fieldKits). FKR-7 stamps the flag at dispatch (and
// keeps each member's charges across an objective's fights); until then these tests stamp it by hand. A run without the
// flag fights byte-identically, each grenade's passive on-hit included (fieldKitsGoldens.test.ts FKR-0 (1)).
//
// Covered: the user's numbers (FK11, N4 Impact 4 / Stun 2 / Toxin 2, 1 throw per battle; N6 the Impact Grenade's group
// blast at 1.5x and 30% Concussion), the carry line (a count, +1 charge, never effect magnitude), the snapshot's frozen
// carry, the throw (the target's group only, one charge, the skip rules FK11 asks for), Saboteur on own throws only
// (FK10), the passive on-hit gone on a Field Kits run only (N7), the record's chargesUsed, the threat memo, and
// offline == live on a stamped run whose squad throws.

import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_SLOTS,
  GRENADE_CARRY_PER_LINE,
  GRENADE_CHARGES_PLAIN,
  GRENADE_CHARGES_SPECIALIZED,
  GRENADE_THROWS_PER_BATTLE,
  IMPACT_GRENADE_CONCUSSION_CHANCE,
  IMPACT_GRENADE_POWER_MULT,
  IMPACT_GRENADE_RECIPE,
  SPECIALIZED_GRENADE_POWER_MULT,
  BLUEPRINTS,
  FIELD_KITS_HIDDEN_BLUEPRINTS,
  FIELD_KITS_PLAYER_LIVE,
  freshState,
  grenadeCraftPool,
  memberVariety,
  type AwayMember,
  type BodyRiskGrades,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type GambitProgram,
  type GameState,
  type ShipGroundTeam,
  type SnapshotMember,
} from "./model";
import { canThrowGrenade, evaluateAndAct, isActionLegalForRole, memberStatusChance, resolveGroundBattle, type BattleState, type GroundCombatant } from "./gambit";
import { memberGrenade, pieceCarryLines, pieceToolCharges, snapshotMember, toolCharges } from "./awayTeam";
import { GRENADES, GRENADE_IDS, chargesLeftFor, passiveInflictStatuses, withThrownGrenades } from "./fieldKitsGrenades";
import { FIELD_KITS_CATALOG_VERSION, SABOTEUR_GRENADE_BONUS } from "./fieldKits";
import { generateEquipment, rolledLineValue } from "./itemgen";
import { resolveTaskFight, taskFightTeam, type GroundFightTeam } from "./groundFight";
import { groundThreatOddsKey } from "./groundThreat";
import { advanceExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { makeRng } from "./combat/rng";
import { plainAwayMember, withoutFieldKits, dispatchPastPropulsion } from "./awayTeamTestFixtures";

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

function battle(combatants: GroundCombatant[]): BattleState {
  return { combatants, round: 0, teamKit: 0, tauntedBy: null };
}

function piece(id: string, slotType: EquipmentInstance["slotType"], variety: string, wearer: string, lines: Record<string, number> = {}, rolled: Record<string, number> = {}): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: lines,
    rolledStats: rolled,
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

const security = (id: string, over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(id, "security", "ship-1"), ...over });

// A member's snapshot wearing `worn` (the dispatch freeze).
const snap = (worn: EquipmentInstance[], over: Partial<AwayMember> = {}): SnapshotMember => snapshotMember(security("member-1", over), worn);

// A fresh combatant for a snapshot, armed the way a Field Kits fight arms it.
function armed(m: SnapshotMember, chargesLeft?: Record<string, number>, over: Partial<GroundCombatant> = {}): GroundCombatant {
  const c = gc("a1", "team", { memberId: m.memberId, ...over });
  withThrownGrenades([c], [m], chargesLeft);
  return c;
}

const THROW: GambitProgram = [{ target: "foeLargestGroup", action: "throwGrenade" }, { target: "foeNearest", action: "attack" }];

// ===== the catalog =====

describe("the grenade family: the user's numbers (FK11, N4, N6)", () => {
  it("the Impact Grenade is the plain grenade, Stun and Toxin the specialized ones; nothing else throws", () => {
    expect(GRENADE_IDS).toEqual(["stunGrenade", "toxinGrenade", "impactGrenade"]);
    expect(GRENADES.impactGrenade.charges).toEqual({ perObjective: 4, perBattle: 1 });
    expect(GRENADES.stunGrenade.charges).toEqual({ perObjective: 2, perBattle: 1 });
    expect(GRENADES.toxinGrenade.charges).toEqual({ perObjective: 2, perBattle: 1 });
    expect([GRENADE_CHARGES_PLAIN, GRENADE_CHARGES_SPECIALIZED, GRENADE_THROWS_PER_BATTLE]).toEqual([4, 2, 1]);
    expect(GRENADES.impactGrenade).toMatchObject({ powerMult: 1.5, status: "concussion", statusChance: 0.3 });
    expect([IMPACT_GRENADE_POWER_MULT, IMPACT_GRENADE_CONCUSSION_CHANCE]).toEqual([1.5, 0.3]);
    expect(GRENADES.stunGrenade).toMatchObject({ powerMult: SPECIALIZED_GRENADE_POWER_MULT, status: "stun" });
    expect(GRENADES.toxinGrenade).toMatchObject({ powerMult: SPECIALIZED_GRENADE_POWER_MULT, status: "poison" });
    expect(GRENADES.stunGrenade.statusChance).toBeUndefined();
    // N4 "Grenades only": the Med Kit, Shroud Emitter and Lure Beacon carry no charges.
    for (const key of ["medKit", "shroudEmitter", "lureBeacon"]) expect(memberVariety("memberTool", key)!.member.grenade, key).toBeUndefined();
  });

  it("the Impact Grenade is a Security tool with no passive effect, a tier 1 blueprint, and its own pool", () => {
    const v = memberVariety("memberTool", "impactGrenade")!;
    expect(v.label).toBe("Impact Grenade");
    expect(v.member.teamTypes).toEqual(["security"]);
    expect(v.member.groundEffect).toBeUndefined();
    const bp = FIELD_KITS_HIDDEN_BLUEPRINTS.impactGrenadeBp;
    expect(bp.equipmentOutput).toEqual({ slotType: "memberTool", varietyKey: "impactGrenade" });
    expect(bp.tier).toBe(1);
    expect(bp.recipe.inputs).toEqual(IMPACT_GRENADE_RECIPE);
    expect(bp.researchCreditCost).toBe(700);
    // Hidden until FKR-7 (user 2026-10-20): out of BLUEPRINTS (Research, Fabricator, Archive) until the switch flips.
    expect("impactGrenadeBp" in BLUEPRINTS).toBe(FIELD_KITS_PLAYER_LIVE);
    if (FIELD_KITS_PLAYER_LIVE) expect(BLUEPRINTS.impactGrenadeBp).toBe(bp);
  });

  it("the grenade pools carry the carry capacity line (Stun and Toxin once FIELD_KITS_PLAYER_LIVE), no other piece does", () => {
    for (const slot of ["memberWeapon", "memberArmor", "memberTool", "implant"] as const) {
      for (const v of EQUIPMENT_SLOTS[slot].varieties) {
        const pool = (v.affixPool ?? EQUIPMENT_SLOTS[slot].affixPool).map((a) => a.stat);
        const want = v.key === "impactGrenade" || (FIELD_KITS_PLAYER_LIVE && GRENADE_IDS.includes(v.key));
        expect(pool.includes("groundCarryCapacity"), v.key).toBe(want);
        expect((v.implicitStats ?? []).includes("groundCarryCapacity"), v.key).toBe(false);
      }
    }
    // The switch picks the pool: the carry pools add the line at weight 1 and a 0.15 share; the shares sum to 1.
    for (const key of ["stunGrenade", "toxinGrenade"] as const) {
      const live = grenadeCraftPool(key, true);
      expect(live.affixPool.find((a) => a.stat === "groundCarryCapacity")?.weight, key).toBe(1);
      expect(live.statRatios.groundCarryCapacity, key).toBe(0.15);
      expect(grenadeCraftPool(key, false).affixPool.some((a) => a.stat === "groundCarryCapacity"), key).toBe(false);
      for (const p of [live, grenadeCraftPool(key, false)]) expect(Object.values(p.statRatios).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    }
  });
});

// ===== the carry line =====

describe("the +1 carry capacity line (FK11): a charge count, never effect magnitude", () => {
  it("is minted as GRENADE_CARRY_PER_LINE whatever the budget, and a Radiant grenade (three picks of three) always rolls it", () => {
    expect(rolledLineValue("groundCarryCapacity", 37)).toBe(GRENADE_CARRY_PER_LINE);
    expect(rolledLineValue("groundPower", 37)).toBe(37);
    const radiant = (varietyKey: string): EquipmentInstance => {
      let n = 0;
      return generateEquipment({ slotType: "memberTool", varietyKey, blueprintKey: null, iLevel: 30, quality: 3, rarity: "radiant", ascension: "none", rng: () => 0.37, allocateId: () => `equip-${(n += 1)}` });
    };
    // With the carry pools installed (FIELD_KITS_PLAYER_LIVE on), every grenade's Radiant craft rolls the line.
    const varieties = EQUIPMENT_SLOTS.memberTool.varieties as unknown as { key: string; affixPool?: unknown; statRatios: unknown }[];
    const saved = varieties.map((v) => ({ v, affixPool: v.affixPool, statRatios: v.statRatios }));
    try {
      for (const v of varieties) if (v.key === "stunGrenade" || v.key === "toxinGrenade") Object.assign(v, grenadeCraftPool(v.key, true));
      for (const varietyKey of GRENADE_IDS) {
        const p = radiant(varietyKey);
        expect(p.rolledStats.groundCarryCapacity, varietyKey).toBe(1);
        expect(pieceCarryLines(p)).toBe(1);
        expect(pieceToolCharges(p)).toBe(GRENADES[varietyKey].charges.perObjective + 1);
      }
    } finally {
      for (const { v, affixPool, statRatios } of saved) Object.assign(v, { affixPool, statRatios });
    }
    // Hidden until FKR-7: with the switch off a new Stun or Toxin craft never rolls it.
    if (!FIELD_KITS_PLAYER_LIVE) for (const varietyKey of ["stunGrenade", "toxinGrenade"]) expect(radiant(varietyKey).rolledStats.groundCarryCapacity, varietyKey).toBeUndefined();
  });

  it("counts lines, not values; a piece with none adds nothing; a non-grenade has no charges", () => {
    expect(pieceCarryLines(piece("e1", "memberTool", "stunGrenade", "m", { groundCarryCapacity: 20 }))).toBe(1);
    expect(pieceCarryLines(piece("e1", "memberTool", "stunGrenade", "m", { groundCarryCapacity: 1 }, { groundCarryCapacity: 1 }))).toBe(2);
    expect(pieceToolCharges(piece("e1", "memberTool", "stunGrenade", "m"))).toBe(2);
    expect(pieceToolCharges(piece("e1", "memberTool", "impactGrenade", "m"))).toBe(4);
    expect(pieceToolCharges(piece("e1", "memberTool", "medKit", "m", { groundCarryCapacity: 1 }))).toBe(0);
  });

  it("the snapshot freezes it only when present, keeps it out of the effect points, and toolCharges reads it", () => {
    const plain = snap([piece("equip-1", "memberTool", "stunGrenade", "member-1", { groundStatusChance: 10 })]);
    expect(plain.gear[0]).toEqual({ pieceId: "equip-1", slotType: "memberTool", varietyKey: "stunGrenade", points: 10 });
    expect(toolCharges(plain)).toBe(2);
    const carried = snap([piece("equip-1", "memberTool", "stunGrenade", "member-1", { groundStatusChance: 10 }, { groundCarryCapacity: 1 })]);
    expect(carried.gear[0]).toEqual({ pieceId: "equip-1", slotType: "memberTool", varietyKey: "stunGrenade", points: 10, carry: 1 });
    // The inflict effect's magnitude and every member stat read exactly as without the line.
    expect(carried.effects).toEqual(plain.effects);
    expect(carried.groundStats).toEqual(plain.groundStats);
    expect(toolCharges(carried)).toBe(3);
    expect(memberGrenade(carried)?.grenade).toBe(GRENADES.stunGrenade);
    expect(toolCharges(snap([piece("equip-1", "memberTool", "medKit", "member-1")]))).toBe(0);
    expect(toolCharges(snap([]))).toBe(0);
  });
});

// ===== arming a squad =====

describe("arming a Field Kits fight's squad (fieldKitsGrenades.ts)", () => {
  it("a grenade arms its throw: full charges by default, the stored count when the team carries one", () => {
    const m = snap([piece("equip-1", "memberTool", "impactGrenade", "member-1")]);
    expect(armed(m).grenade).toEqual({ status: "concussion", statusPermille: 300, powerMult: 1.5, charges: 4, perBattle: 1, used: 0 });
    expect(armed(m, { "member-1": 1 }).grenade?.charges).toBe(1);
    expect(armed(m, { "member-1": 0 }).grenade?.charges).toBe(0);
    expect(armed(m, { "member-9": 0 }).grenade?.charges).toBe(4);
    expect(chargesLeftFor(m, { "member-1": 2.7 })).toBe(2);
    expect(chargesLeftFor(m, { "member-1": -3 })).toBe(0);
    expect(chargesLeftFor(m, { "member-1": Number.NaN })).toBe(4);
  });

  it("a Stun or Toxin Grenade's debuff lands at the thrower's status chance (THE STATUS-CHANCE RULE)", () => {
    const m = snap([piece("equip-1", "memberTool", "toxinGrenade", "member-1", { groundStatusChance: 40 })], { spec: "debuff" });
    const c = armed(m);
    expect(c.grenade?.statusPermille).toBe(Math.round(memberStatusChance(m) * 1000));
    expect(c.grenade?.statusPermille).toBeGreaterThan(100);
    expect(c.grenade?.status).toBe("poison");
  });

  it("Saboteur (FK10): x1.06 on the Saboteur's own blast and debuff chance, never a squadmate's", () => {
    const worn = [piece("equip-1", "memberTool", "impactGrenade", "member-1")];
    const sab = armed(snap(worn, { traits: ["saboteur"] })).grenade!;
    expect(sab.powerMult).toBeCloseTo(1.5 * (1 + SABOTEUR_GRENADE_BONUS), 12);
    expect(sab.statusPermille).toBe(Math.round(0.3 * (1 + SABOTEUR_GRENADE_BONUS) * 1000));
    // A squadmate of the Saboteur throws at the plain numbers.
    const team = [gc("a1", "team", { memberId: "member-1" }), gc("a2", "team", { memberId: "member-2" })];
    const mate = snapshotMember(security("member-2"), [piece("equip-2", "memberTool", "impactGrenade", "member-2")]);
    withThrownGrenades(team, [snap(worn, { traits: ["saboteur"] }), mate]);
    expect(team[1].grenade?.powerMult).toBe(1.5);
  });

  it("the grenade's passive on-hit is taken off; a Shock Baton's stun stays; a squad without grenades is untouched", () => {
    const m = snap([piece("equip-1", "memberTool", "stunGrenade", "member-1", { groundStatusChance: 40 }), piece("equip-2", "memberWeapon", "shockBaton", "member-1")]);
    expect([...passiveInflictStatuses(m)]).toEqual(["stun"]);
    const both = gc("a1", "team", { memberId: "member-1", onHitStatuses: [{ id: "stun", permille: 200 }] });
    withThrownGrenades([both], [m]);
    expect(both.onHitStatuses).toEqual([{ id: "stun", permille: 200 }]);
    const toxin = snap([piece("equip-1", "memberTool", "toxinGrenade", "member-1", { groundStatusChance: 40 })]);
    const c = gc("a1", "team", { memberId: "member-1", onHitStatuses: [{ id: "poison", permille: 200 }] });
    withThrownGrenades([c], [toxin]);
    expect(c.onHitStatuses).toBeUndefined();
    expect(c.grenade?.status).toBe("poison");
    const bare = gc("a1", "team", { memberId: "member-1" });
    const before = structuredClone(bare);
    withThrownGrenades([bare], [snap([piece("equip-1", "memberTool", "medKit", "member-1")])]);
    expect(bare).toEqual(before);
  });
});

// ===== the throw =====

describe("throwGrenade: the target's group, one charge, the FK11 skip rules", () => {
  const grenade = (over: Partial<NonNullable<GroundCombatant["grenade"]>> = {}) => ({ status: "concussion" as const, statusPermille: 0, powerMult: 1.5, charges: 4, perBattle: 1, used: 0, ...over });

  it("is a Security action anyone may take; it fires only with a charge and a throw left", () => {
    expect(isActionLegalForRole("security", "throwGrenade")).toBe(true);
    expect(canThrowGrenade(gc("a1", "team"))).toBe(false);
    expect(canThrowGrenade(gc("a1", "team", { grenade: grenade() }))).toBe(true);
    expect(canThrowGrenade(gc("a1", "team", { grenade: grenade({ charges: 0 }) }))).toBe(false);
    expect(canThrowGrenade(gc("a1", "team", { grenade: grenade({ used: 1 }) }))).toBe(false);
  });

  it("blasts the target's whole group at power x powerMult, never another group, and spends one charge", () => {
    const thrower = gc("a1", "team", { power: 100, grenade: grenade() });
    const foes = [gc("e1", "enemy", { hp: 1000, hpMax: 1000 }), gc("e2", "enemy", { hp: 1000, hpMax: 1000 }), gc("e3", "enemy", { hp: 1000, hpMax: 1000, groupTag: "b" })];
    const st = battle([thrower, ...foes]);
    evaluateAndAct([{ target: "foeNearest", action: "throwGrenade" }], thrower, st, makeRng(7));
    for (const f of foes.slice(0, 2)) {
      const dmg = 1000 - f.hp;
      expect(dmg).toBeGreaterThanOrEqual(Math.round(100 * 1.5 * 0.85));
      expect(dmg).toBeLessThanOrEqual(Math.round(100 * 1.5 * 1.15));
    }
    expect(foes[2].hp).toBe(1000);
    expect(thrower.grenade?.used).toBe(1);
  });

  it("its debuff lands through the chance and the resist roll; a chance of 0 never lands", () => {
    const run = (permille: number, resists?: GroundCombatant["resists"]) => {
      const thrower = gc("a1", "team", { grenade: grenade({ statusPermille: permille }) });
      const foes = [gc("e1", "enemy", { hp: 1000, hpMax: 1000, resists }), gc("e2", "enemy", { hp: 1000, hpMax: 1000, resists })];
      evaluateAndAct([{ target: "foeNearest", action: "throwGrenade" }], thrower, battle([thrower, ...foes]), makeRng(11));
      return foes.filter((f) => f.statuses.some((s) => s.id === "concussion")).length;
    };
    expect(run(1000)).toBe(2);
    expect(run(0)).toBe(0);
    expect(run(1000, { concussion: 1000 })).toBe(0);
  });

  it("FK11: out of charges, or past this battle's throw, the rule is skipped and the next rule acts", () => {
    const foe = () => gc("e1", "enemy", { hp: 1000, hpMax: 1000 });
    const spent = gc("a1", "team", { grenade: grenade({ charges: 0 }) });
    const st = battle([spent, foe()]);
    st.log = [];
    evaluateAndAct(THROW, spent, st, makeRng(3));
    expect(st.log.map((e) => e.action)).toEqual(["attack"]);
    const thrower = gc("a1", "team", { grenade: grenade() });
    const st2 = battle([thrower, foe()]);
    st2.log = [];
    evaluateAndAct(THROW, thrower, st2, makeRng(3));
    evaluateAndAct(THROW, thrower, st2, makeRng(4));
    expect(st2.log.map((e) => e.action)).toEqual(["throwGrenade", "attack"]);
  });

  it("a whole battle throws once per grenade and reports the charges spent; a battle without a grenade reports none", () => {
    const thrower = gc("a1", "team", { memberId: "member-1", hp: 5000, hpMax: 5000, program: THROW, grenade: grenade({ charges: 99 }) });
    const r = resolveGroundBattle([thrower], [gc("e1", "enemy", { hp: 3000, hpMax: 3000 })], 0, makeRng(5));
    expect(r.chargesUsed).toEqual({ "member-1": 1 });
    const plain = resolveGroundBattle([gc("a1", "team", { memberId: "member-1", program: THROW })], [gc("e1", "enemy")], 0, makeRng(5));
    expect(plain.chargesUsed).toBeUndefined();
    expect(Object.keys(plain)).not.toContain("chargesUsed");
  });

  it("the log reads a throw that hit its target as a hit and one that missed as a miss", () => {
    const thrower = gc("a1", "team", { accuracy: 0, grenade: grenade() });
    const st = battle([thrower, gc("e1", "enemy")]);
    st.log = [];
    evaluateAndAct([{ target: "foeNearest", action: "throwGrenade" }], thrower, st, makeRng(1));
    expect(st.log[0]).toMatchObject({ action: "throwGrenade", missed: true });
    const hit = gc("a1", "team", { grenade: grenade() });
    const st2 = battle([hit, gc("e1", "enemy")]);
    st2.log = [];
    evaluateAndAct([{ target: "foeNearest", action: "throwGrenade" }], hit, st2, makeRng(1));
    expect(st2.log[0].missed).toBeUndefined();
    expect(st2.log[0].hpDelta).toBeLessThan(0);
  });
});

// ===== real runs (the fieldKitsConditions.test.ts hand-run pattern) =====

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const GRENADIERS: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-2": "stunGrenade", "member-4": "toxinGrenade" };

// Two ground teams; three members carry a grenade (each its own kind) and run `program` (absent: the default program).
function crewed(expeditionSeed: number, program?: GambitProgram): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(program && teamType === "security" ? { gambit: program.map((r) => ({ ...r })) } : {}),
  });
  const gear = Object.entries(GRENADIERS).map(([wearer, variety], i) => piece(`equip-${900 + i}`, "memberTool", variety, wearer, { groundStatusChance: 30 }));
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    equipment: [...base.equipment, ...gear],
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

function handRun(state: GameState, pois: string[], risk: BodyRiskGrades, kits: boolean, hazard = 0.2): Expedition {
  const res = dispatchPastPropulsion(state, "ship-1", 1, "cand-0");
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

const fightTeamsOf = (exp: Expedition, charges?: Record<string, number>): GroundFightTeam[] =>
  exp.groundOps!.teams.map((t, i) => ({
    securityIds: t.securityIds,
    downedThisTask: t.downedThisTask,
    securityShare: exp.groundOps!.factors.securityShare[i],
    ...(charges ? { charges } : {}),
  }));
const kitted = (e: Expedition): Expedition => ({ ...e, fieldKits: KITS });
const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;

describe("grenades on a real run's fights, behind the flag", () => {
  const throwing = handRun(crewed(0xc4a2, THROW), ["enemyColony", "derelictOutpost"], { ...CALM, combat: 2 }, false);

  it("the flag-less run keeps every grenade's passive on-hit and never arms a throw", () => {
    const team = taskFightTeam(throwing, fightTeamsOf(throwing), { id: "t", fightCount: 0 });
    for (const id of Object.keys(GRENADIERS)) {
      const c = team.find((x) => x.memberId === id)!;
      expect(c.grenade, id).toBeUndefined();
    }
    // The Stun and Toxin wearers keep their passive roll; the Impact Grenade never had one.
    expect(team.find((x) => x.memberId === "member-2")!.onHitStatuses).toEqual([{ id: "stun", permille: expect.any(Number) }]);
    expect(team.find((x) => x.memberId === "member-4")!.onHitStatuses).toEqual([{ id: "poison", permille: expect.any(Number) }]);
    expect(team.find((x) => x.memberId === "member-1")!.onHitStatuses).toBeUndefined();
    const task = { ...tasksOf(throwing)[0], fightCount: 0, pointsCleared: 0 };
    expect(resolveTaskFight(throwing, fightTeamsOf(throwing), throwing.bodies[0], task, 0).chargesUsed).toBeUndefined();
  });

  it("the stamped twin arms each grenadier (full charges), drops the passive, and records the charges thrown", () => {
    const exp = kitted(throwing);
    const team = taskFightTeam(exp, fightTeamsOf(exp), { id: "t", fightCount: 0 });
    expect(team.find((x) => x.memberId === "member-1")!.grenade).toMatchObject({ status: "concussion", charges: 4, perBattle: 1, used: 0 });
    expect(team.find((x) => x.memberId === "member-2")!.grenade).toMatchObject({ status: "stun", charges: 2 });
    expect(team.find((x) => x.memberId === "member-4")!.grenade).toMatchObject({ status: "poison", charges: 2 });
    expect(team.find((x) => x.memberId === "member-3")!.grenade).toBeUndefined();
    for (const id of Object.keys(GRENADIERS)) expect(team.find((x) => x.memberId === id)!.onHitStatuses, id).toBeUndefined();
    const task = { ...tasksOf(exp)[0], fightCount: 0, pointsCleared: 0 };
    const record = resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], task, 0);
    expect(record.chargesUsed).toEqual({ "member-1": 1, "member-2": 1, "member-4": 1 });
  });

  it("charges left ride in on the team: none left means no throw (the next rule acts) and no chargesUsed", () => {
    const exp = kitted(throwing);
    const task = { ...tasksOf(exp)[0], fightCount: 0, pointsCleared: 0 };
    const none = { "member-1": 0, "member-2": 0, "member-4": 0 };
    const record = resolveTaskFight(exp, fightTeamsOf(exp, none), exp.bodies[0], task, 0);
    expect(record.chargesUsed).toBeUndefined();
    const some = resolveTaskFight(exp, fightTeamsOf(exp, { "member-1": 0 }), exp.bodies[0], task, 0);
    expect(some.chargesUsed).toEqual({ "member-2": 1, "member-4": 1 });
  });

  it("a stamped run on the default program throws (FKR-6, N15: the Field Kits default); the flag-less twin never does", () => {
    const plain = handRun(crewed(0xc4a2), ["enemyColony"], { ...CALM, combat: 2 }, false);
    const quiet = kitted(plain);
    const task = { ...tasksOf(quiet)[0], fightCount: 0, pointsCleared: 0 };
    expect(resolveTaskFight(quiet, fightTeamsOf(quiet), quiet.bodies[0], task, 0).chargesUsed).toEqual({ "member-1": 1, "member-2": 1, "member-4": 1 });
    expect(resolveTaskFight(plain, fightTeamsOf(plain), plain.bodies[0], task, 0).chargesUsed).toBeUndefined();
  });

  it("a stamped fight is deterministic and its log names the throws", () => {
    const exp = kitted(throwing);
    const task = { ...tasksOf(exp)[1], fightCount: 1, pointsCleared: 0 };
    const log: Parameters<typeof resolveTaskFight>[6] = [];
    const a = resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], task, 1);
    const b = resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], task, 1, undefined, log);
    expect(b).toEqual(a);
    expect(log!.filter((e) => e.action === "throwGrenade").length).toBe(3);
  });

  it("the threat memo keys the charges on a stamped run only; a flag-less key never reads them", () => {
    const task = tasksOf(throwing)[0];
    const plain = groundThreatOddsKey(throwing, fightTeamsOf(throwing), throwing.bodies[0], task, 0, 32);
    expect(groundThreatOddsKey(throwing, fightTeamsOf(throwing, { "member-1": 0 }), throwing.bodies[0], task, 0, 32)).toBe(plain);
    const exp = kitted(throwing);
    const full = groundThreatOddsKey(exp, fightTeamsOf(exp), exp.bodies[0], task, 0, 32);
    expect(groundThreatOddsKey(exp, fightTeamsOf(exp, { "member-1": 0 }), exp.bodies[0], task, 0, 32)).not.toBe(full);
  });

  it("a stamped run whose squad throws: one call == 997 s chunks == 1 s steps", { timeout: 300_000 }, () => {
    const exp = kitted(handRun(crewed(0xf0f7, THROW), ["enemyFortification", "derelictOutpost"], { ...CALM, combat: 4 }, false));
    const end = T0 + 200_000;
    const one = advanceExpedition(exp, end);
    let e = exp;
    for (let t = T0 + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(one);
    const H = T0 + 3 * 3600;
    let s = exp;
    let threw = false;
    for (let t = T0 + 1; t <= H; t += 1) {
      s = advanceExpedition(s, t);
      threw ||= s.groundOps!.teams.some((team) => team.pendingFight?.chargesUsed !== undefined);
    }
    expect(s).toEqual(advanceExpedition(exp, H));
    expect(advanceExpedition(s, end)).toEqual(one);
    // The squad threw on the stamped run (a fight in flight carried its chargesUsed); the flag-less twin's fights differ
    // (their grenades stay passive).
    expect(threw).toBe(true);
    expect(JSON.stringify(advanceExpedition(withoutFieldKits(exp), end).groundOps)).not.toBe(JSON.stringify(one.groundOps));
  });
});
