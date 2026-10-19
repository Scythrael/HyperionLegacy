// Field Kits FKR-4 (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-4): the CONDITIONS and the ENEMY
// INFLICTORS, behind flag 2 (Expedition.fieldKits). FKR-7 stamps the flag at dispatch; until then these tests stamp
// it by hand. A run without the flag fights byte-identically (fieldKitsGoldens.test.ts and every earlier golden).
//
// Covered: each new status's effect at the user's numbers (FK13), the bone line's worsening (N10) and its power and
// accuracy cut, the turn loss, Cure and the team kit on basic debuffs only (FK2), Cortex Shield's stun resist covering
// Concussion (FK6), Stoneskin's battle half (D24), each inflictor (FK7, N14), the flag gate on the guard and the squad,
// the medical bay rows (N11), Iron Will and Morale Anchor moving a fight, the threat memo, and offline == live on a
// stamped run.

import { describe, expect, it } from "vitest";
import {
  freshState,
  type AwayMember,
  type BodyRiskGrades,
  type Expedition,
  type ExpeditionActivity,
  type ExpeditionBody,
  type GambitStatusId,
  type GameState,
  type ShipGroundTeam,
} from "./model";
import {
  BASIC_DEBUFFS,
  BLINDNESS_MIN_ROUNDS,
  BLINDNESS_ROUND_SPAN,
  BONE_LINE,
  GAMBIT_STATUSES,
  NEUROTOXIN_TURN_LOSS,
  STONESKIN_BATTLE_RESIST,
  applyStatus,
  evaluateAndAct,
  generateEncounter,
  resolveGroundBattle,
  statusResistPermille,
  strikeHitChance,
  tickEndOfRound,
  turnLossPermille,
  type BattleState,
  type GambitLogEvent,
  type GroundCombatant,
} from "./gambit";
import {
  BRUISER_HEAVY_HIT,
  FEAR_ON_HIT_PERMILLE,
  FLASH_GRENADES_PER_STRIKER,
  FLASH_GRENADE_RULE,
  HEAVY_HIT_FRACTION,
  NEUROTOXIN_FROM_GRADE,
  STRIKER_EXECUTE_AFFLICTION,
  withFieldKitsGuard,
} from "./fieldKitsConditions";
import { CONDITION_LINES, FIELD_KITS_CATALOG_VERSION, FIELD_KIT_STATUS_IDS, fieldKitsLive } from "./fieldKits";
import { resolveTaskFight, taskFightGuard, taskFightTeam, type GroundFightTeam } from "./groundFight";
import { GROUND_CONDITIONS, memberBaySeconds } from "./medicalBay";
import { advanceExpedition, startExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { groundThreatOddsKey } from "./groundThreat";
import { makeRng } from "./combat/rng";
import { plainAwayMember, withoutFieldKits } from "./awayTeamTestFixtures";

const KITS = { catalog: FIELD_KITS_CATALOG_VERSION };
const NO_CARE = { medicalShare: 0, rapidRecoveryShare: 0, officerFacetShare: 0, injurySteady: 0 };

// ===== hand-built battles =====

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
    groupTag: side === "team" ? "security" : "bruiser",
    statuses: [],
    downed: false,
    ...over,
  };
}
const battle = (combatants: GroundCombatant[], teamKit = 0): BattleState => ({ combatants, round: 0, teamKit, tauntedBy: null });
const ids = (c: GroundCombatant): GambitStatusId[] => c.statuses.map((s) => s.id);

describe("Field Kits conditions: the user's numbers (FK13) and their effects", () => {
  it("the seven conditions carry FK13's numbers; the bone line cuts more at each rank", () => {
    expect(GAMBIT_STATUSES.hemorrhage).toMatchObject({ kind: "debuff", effect: "dotDamage", magnitude: 12, duration: 4 });
    expect(GAMBIT_STATUSES.neurotoxin).toMatchObject({ kind: "debuff", effect: "dotTurnLoss", magnitude: 5, duration: 4 });
    expect(NEUROTOXIN_TURN_LOSS).toBe(0.25);
    expect(GAMBIT_STATUSES.concussion).toMatchObject({ kind: "debuff", effect: "turnLoss", magnitude: 0.35, duration: 3 });
    expect(GAMBIT_STATUSES.blindness).toMatchObject({ kind: "debuff", effect: "accuracyDown", magnitude: 0.75 });
    expect([BLINDNESS_MIN_ROUNDS, BLINDNESS_MIN_ROUNDS + BLINDNESS_ROUND_SPAN - 1]).toEqual([2, 3]);
    expect(BONE_LINE.map((id) => 1 - GAMBIT_STATUSES[id].magnitude)).toEqual([0.8, 0.7, 0.6]);
    expect(CONDITION_LINES.bone.map((r) => [r.id, r.label])).toEqual([
      ["fracture", "Fracture"],
      ["brokenBone", "Broken Bone"],
      ["shatteredBone", "Shattered Bone"],
    ]);
    for (const id of FIELD_KIT_STATUS_IDS) expect(GAMBIT_STATUSES[id].id).toBe(id);
  });

  it("Blindness cuts the hit chance to a quarter; a bone condition cuts hit chance and damage by its rank", () => {
    const c = gc("a1", "team", { accuracy: 0.9 });
    applyStatus(c, "blindness");
    expect(strikeHitChance(c, {})).toBeCloseTo(0.9 * 0.25, 12);
    for (const id of BONE_LINE) {
      const hurt = gc("a1", "team", { accuracy: 0.9 });
      applyStatus(hurt, id);
      expect(strikeHitChance(hurt, {})).toBeCloseTo(0.9 * (1 - GAMBIT_STATUSES[id].magnitude), 12);
      const dealt = (attacker: GroundCombatant, seed: number) => {
        const st = battle([attacker, gc("e1", "enemy", { hp: 10_000, hpMax: 10_000 })]);
        evaluateAndAct([{ target: "foeNearest", action: "attack" }], attacker, st, makeRng(seed));
        return 10_000 - st.combatants[1].hp;
      };
      // The cut hit chance can miss; on every seed where the cut strike lands, it deals the rank's share of the damage.
      let landed = 0;
      for (let seed = 1; seed <= 20; seed += 1) {
        const cut = gc("a1", "team", { power: 1000 });
        applyStatus(cut, id);
        const d = dealt(cut, seed);
        if (d === 0) continue;
        landed += 1;
        expect(d / dealt(gc("a1", "team", { power: 1000 }), seed)).toBeCloseTo(1 - GAMBIT_STATUSES[id].magnitude, 2);
      }
      expect(landed).toBeGreaterThan(5);
    }
  });

  it("Hemorrhage and Neurotoxin tick each round; Concussion and Neurotoxin cost turns (independent chances)", () => {
    for (const [id, dot] of [["hemorrhage", 12], ["neurotoxin", 5]] as const) {
      const c = gc("e1", "enemy");
      applyStatus(c, id);
      tickEndOfRound(battle([c]));
      expect(c.hp).toBe(100 - dot);
    }
    const c = gc("a1", "team");
    expect(turnLossPermille(c)).toBe(0);
    applyStatus(c, "concussion");
    expect(turnLossPermille(c)).toBe(350);
    const n = gc("a1", "team");
    applyStatus(n, "neurotoxin");
    expect(turnLossPermille(n)).toBe(250);
    applyStatus(n, "concussion");
    expect(turnLossPermille(n)).toBeGreaterThanOrEqual(512);
    expect(turnLossPermille(n)).toBeLessThanOrEqual(513);
  });

  it("a Concussed member loses about a third of its turns over a long fight", () => {
    const actions = (concussed: boolean): number => {
      const member = gc("a1", "team", { memberId: "m1", power: 1 });
      if (concussed) applyStatus(member, "concussion", undefined, 1000);
      const log: GambitLogEvent[] = [];
      resolveGroundBattle([member], [gc("e1", "enemy", { hp: 1_000_000, hpMax: 1_000_000, power: 0 })], 0, makeRng(0xc0c0), log);
      return log.filter((e) => e.memberId === "m1").length;
    };
    const clear = actions(false);
    const dazed = actions(true);
    expect(clear).toBe(40);
    expect(dazed).toBeLessThan(clear * 0.85);
    expect(dazed).toBeGreaterThan(clear * 0.45);
  });
});

describe("Field Kits conditions: the bone line worsens (N10), heavy hits, executes and flash grenades", () => {
  const bruiser = (power: number) => gc("e1", "enemy", { power, heavyHit: { fraction: HEAVY_HIT_FRACTION, statuses: [...BRUISER_HEAVY_HIT] } });

  it("a heavy hit lands a Fracture and a Concussion; repeat heavy hits worsen the bone one rank, never past Shattered Bone", () => {
    const target = gc("a1", "team", { hp: 100_000, hpMax: 100_000 });
    const hit = bruiser(40_000);
    const seen: string[][] = [];
    for (let i = 0; i < 4; i += 1) {
      evaluateAndAct([{ target: "foeNearest", action: "attack" }], hit, battle([hit, target]), makeRng(0x100 + i));
      target.hp = target.hpMax;
      seen.push(ids(target).filter((id) => BONE_LINE.includes(id)));
      expect(ids(target)).toContain("concussion");
    }
    expect(seen).toEqual([["fracture"], ["brokenBone"], ["shatteredBone"], ["shatteredBone"]]);
  });

  it("a strike under the heavy-hit line inflicts nothing", () => {
    const target = gc("a1", "team");
    const light = bruiser(10);
    evaluateAndAct([{ target: "foeNearest", action: "attack" }], light, battle([light, target]), makeRng(7));
    expect(target.hp).toBeLessThan(100);
    expect(target.statuses).toEqual([]);
  });

  it("a Striker's Execute on a wounded target that still stands brings a Hemorrhage; on a healthy one it does not", () => {
    const striker = () => gc("e1", "enemy", { role: "striker", power: 5, executeAfflicts: STRIKER_EXECUTE_AFFLICTION });
    const wounded = gc("a1", "team", { hp: 30 });
    const s1 = striker();
    evaluateAndAct([{ target: "foeLowestHp", action: "execute" }], s1, battle([s1, wounded]), makeRng(3));
    expect(ids(wounded)).toEqual(["hemorrhage"]);
    const healthy = gc("a1", "team");
    const s2 = striker();
    evaluateAndAct([{ target: "foeLowestHp", action: "execute" }], s2, battle([s2, healthy]), makeRng(3));
    expect(healthy.statuses).toEqual([]);
  });

  it("a flash grenade Blinds the squad's biggest threat for 2 or 3 rounds, once per battle, then the Striker fights on", () => {
    const rounds = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const s = gc("e1", "enemy", { role: "striker", flashGrenades: FLASH_GRENADES_PER_STRIKER });
      const low = gc("a1", "team", { threat: 5 });
      const big = gc("a2", "team", { threat: 50 });
      const st = battle([s, low, big]);
      const program = [{ ...FLASH_GRENADE_RULE }, { target: "foeNearest" as const, action: "attack" as const }];
      evaluateAndAct(program, s, st, makeRng(seed));
      expect(s.flashGrenades).toBe(0);
      expect(low.statuses).toEqual([]);
      const blind = big.statuses.find((x) => x.id === "blindness");
      expect(blind).toBeDefined();
      rounds.add(blind!.remaining);
      const hpBefore = low.hp;
      evaluateAndAct(program, s, st, makeRng(seed + 1000));
      expect(low.hp).toBeLessThan(hpBefore); // no grenade left: the next rule attacks
    }
    expect([...rounds].sort()).toEqual([2, 3]);
  });

  it("the flash grenade is an enemy action: a Security member's rule naming it never fires", () => {
    const member = gc("a1", "team", { flashGrenades: 1 });
    const foe = gc("e1", "enemy");
    const log: GambitLogEvent[] = [];
    const st = { ...battle([member, foe]), log };
    evaluateAndAct([{ target: "foeNearest", action: "flashGrenade" }], member, st, makeRng(1));
    expect(log.map((e) => e.action)).toEqual(["hold"]);
    expect(foe.statuses).toEqual([]);
  });
});

describe("Field Kits conditions: Cure and the team kit clear basic debuffs only (FK2)", () => {
  it("Cure clears the Poison and leaves the Concussion and the bone condition", () => {
    const medic = gc("a1", "team", { medic: true });
    const ally = gc("a2", "team");
    applyStatus(ally, "poison");
    applyStatus(ally, "concussion");
    applyStatus(ally, "fracture");
    evaluateAndAct([{ target: "allyHasStatus", action: "cure" }], medic, battle([medic, ally, gc("e1", "enemy")]), makeRng(1));
    expect(ids(ally).sort()).toEqual(["concussion", "fracture"]);
  });

  it("a Cure or Use Item rule on an ally holding only serious conditions does not fire; the next rule acts", () => {
    for (const action of ["cure", "useItem"] as const) {
      const medic = gc("a1", "team", { medic: true });
      const ally = gc("a2", "team");
      applyStatus(ally, "hemorrhage");
      const foe = gc("e1", "enemy");
      const st = battle([medic, ally, foe], 3);
      evaluateAndAct(
        [
          { target: "allyHasStatus", action },
          { target: "foeNearest", action: "attack" },
        ],
        medic,
        st,
        makeRng(1),
      );
      expect(ids(ally)).toEqual(["hemorrhage"]);
      expect(foe.hp).toBeLessThan(100);
      expect(st.teamKit).toBe(3);
      // Naming a serious condition never fires either.
      const named = battle([medic, ally, gc("e2", "enemy")], 3);
      evaluateAndAct([{ target: "allyHasStatus", params: { statusId: "hemorrhage" }, action }], medic, named, makeRng(1));
      expect(ids(ally)).toEqual(["hemorrhage"]);
    }
  });

  it("a fractured squadmate never blocks the medic's Cure: an any-debuff Cure reaches the ally it can cleanse", () => {
    const medic = gc("a1", "team", { medic: true });
    const fractured = gc("a2", "team", { hp: 10 });
    applyStatus(fractured, "fracture");
    const poisoned = gc("a3", "team", { hp: 80 });
    applyStatus(poisoned, "poison");
    const st = battle([medic, fractured, poisoned, gc("e1", "enemy")]);
    evaluateAndAct([{ target: "allyHasStatus", action: "cure" }], medic, st, makeRng(1));
    expect(ids(poisoned)).toEqual([]);
    expect(ids(fractured)).toEqual(["fracture"]);
  });

  it("the basic list is the user's: Stun and Fear are basic, every serious condition is not", () => {
    for (const id of ["bleed", "blindness", "weakened", "suppressed", "corroded", "poison", "stun", "fear"] as const) expect(BASIC_DEBUFFS).toContain(id);
    for (const id of ["hemorrhage", "neurotoxin", "concussion", ...BONE_LINE] as const) expect(BASIC_DEBUFFS).not.toContain(id);
  });
});

describe("Field Kits conditions: resists (FK6 Cortex Shield, D24 Stoneskin)", () => {
  it("a stun resist covers Concussion (the better of the two rolls); nothing else borrows a resist", () => {
    expect(statusResistPermille(gc("a1", "team", { resists: { stun: 300 } }), "concussion")).toBe(300);
    expect(statusResistPermille(gc("a1", "team", { resists: { stun: 300, concussion: 500 } }), "concussion")).toBe(500);
    expect(statusResistPermille(gc("a1", "team", { resists: { stun: 300 } }), "fracture")).toBe(0);
    expect(statusResistPermille(gc("a1", "team", { resists: { poison: 400 } }), "poison")).toBe(400);
  });

  it("Stoneskin resists a physical status 25% more (independent chances) and its physical status lasts 25% longer", () => {
    expect(STONESKIN_BATTLE_RESIST).toBe(0.25);
    const stone = gc("a1", "team", { stoneskin: true });
    for (const id of ["bleed", "hemorrhage", "concussion", ...BONE_LINE] as const) {
      expect(GROUND_CONDITIONS[id].cls).toBe("injury");
      expect(statusResistPermille(stone, id)).toBe(250);
    }
    for (const id of ["poison", "neurotoxin", "blindness", "fear"] as const) expect(statusResistPermille(stone, id)).toBe(0);
    expect(statusResistPermille(gc("a1", "team", { stoneskin: true, resists: { bleed: 200 } }), "bleed")).toBe(400);
    // A heavy hit that lands its Concussion on a Stoneskin member: ceil(3 x 1.25) = 4 rounds (a seed whose resist roll passes).
    let landed = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const target = gc("a1", "team", { hp: 100_000, hpMax: 100_000, stoneskin: true });
      const hit = gc("e1", "enemy", { power: 40_000, heavyHit: { fraction: HEAVY_HIT_FRACTION, statuses: ["concussion"] } });
      evaluateAndAct([{ target: "foeNearest", action: "attack" }], hit, battle([hit, target]), makeRng(seed));
      const c = target.statuses.find((x) => x.id === "concussion");
      if (c) {
        landed += 1;
        expect(c.remaining).toBe(4);
      }
    }
    expect(landed).toBeGreaterThan(5);
    expect(landed).toBeLessThan(20);
  });
});

describe("Field Kits inflictors: the guard stamping (FK7, N14), behind the flag", () => {
  const guard = (poiId: string, seed = 0x5eed): GroundCombatant[] => generateEncounter(seed, 0.4, poiId);

  it("Bruisers hit heavy, Strikers execute into a Hemorrhage and carry one flash grenade, Swarm inflicts Fear", () => {
    const enemies = withFieldKitsGuard([...guard("ancientRuins"), ...guard("caveNetwork")], { grade: 2, poiId: "ancientRuins" });
    for (const e of enemies) {
      if (e.role === "bruiser") expect(e.heavyHit).toEqual({ fraction: 0.25, statuses: ["fracture", "concussion"] });
      if (e.role === "striker") {
        expect(e.executeAfflicts).toBe("hemorrhage");
        expect(e.flashGrenades).toBe(1);
        expect(e.program?.[0]).toEqual(FLASH_GRENADE_RULE);
      }
      if (e.role === "swarm") expect(e.onHitStatuses).toEqual([{ id: "fear", permille: FEAR_ON_HIT_PERMILLE }]);
      else expect(e.onHitStatuses).toBeUndefined();
    }
  });

  it("a Caster's Poison becomes Neurotoxin from Challenging (N14); a Weakening caster and an unrated objective keep theirs", () => {
    expect(NEUROTOXIN_FROM_GRADE).toBe(3);
    const at = (grade: number | undefined) => withFieldKitsGuard(guard("subterraneanCivilization").concat(guard("xenoFloraBloom")), { grade, poiId: "xenoFloraBloom" });
    const casterHits = (grade: number | undefined) => at(grade).filter((e) => e.role === "caster").map((e) => e.statusOnHit?.id);
    expect(casterHits(2)).toEqual(["poison", "poison"]);
    expect(casterHits(undefined)).toEqual(["poison", "poison"]);
    expect(casterHits(3)).toEqual(["neurotoxin", "neurotoxin"]);
    expect(casterHits(5)).toEqual(["neurotoxin", "neurotoxin"]);
    const weakener = withFieldKitsGuard([{ ...gc("enemy-caster-2", "enemy", { role: "caster" }), statusOnHit: { id: "weakened", permille: 600 } }], { grade: 5, poiId: "x" });
    expect(weakener[0].statusOnHit).toEqual({ id: "weakened", permille: 600 });
  });

  it("every enemy of a hostile garrison inflicts Fear, once each", () => {
    const enemies = withFieldKitsGuard(guard("enemyFortification"), { grade: 5, poiId: "enemyFortification" });
    for (const e of enemies) expect(e.onHitStatuses).toEqual([{ id: "fear", permille: FEAR_ON_HIT_PERMILLE }]);
  });

  it("taskFightGuard stamps nothing without the flag (every stat, id and draw as before) and stamps the inflictors with it", () => {
    const task = { id: "t", poiId: "enemyFortification", fightCount: 0, pointsCleared: 0, difficulty: 5, fightPoints: [0.5] };
    const off = taskFightGuard({ hazardResist: 0 }, { hazard: 0.4 }, task, 0x1234);
    expect(off).toEqual(generateEncounter(0x1234, 0.4, "enemyFortification"));
    const on = taskFightGuard({ hazardResist: 0, fieldKits: KITS }, { hazard: 0.4 }, task, 0x1234);
    expect(on.map((e) => [e.id, e.hp, e.power])).toEqual(off.map((e) => [e.id, e.hp, e.power]));
    expect(on.some((e) => e.heavyHit) && on.some((e) => e.flashGrenades === 1)).toBe(true);
    expect(fieldKitsLive({})).toBe(false);
    expect(fieldKitsLive({ fieldKits: KITS })).toBe(true);
  });
});

// ===== real runs (the groundOpsRanks.test.ts hand-run pattern) =====

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };

function crewed(expeditionSeed: number, over: (m: AwayMember) => AwayMember = (m) => m, rank = 6): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => over({ ...plainAwayMember(id, teamType, "ship-1"), rank: rank as AwayMember["rank"] });
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => member(id, "security")), ...SCI.map((id) => member(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// A real dispatch turned into a run whose window opened at T0 with ONE body just scanned (fieldKitsGoldens handRun),
// with the Field Kits flag stamped by hand when `kits` (FKR-7 stamps it at dispatch).
function handRun(state: GameState, pois: string[], risk: BodyRiskGrades, kits: boolean, hazard = 0.1): Expedition {
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

const fightTeamsOf = (exp: Expedition): GroundFightTeam[] =>
  exp.groundOps!.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i] }));
const kitted = (e: Expedition): Expedition => ({ ...e, fieldKits: KITS });
const tasksOf = (e: Expedition): ExpeditionActivity[] => e.bodies[0].activities;

// Every fight a set of objectives would see on `exp`, over `n` fight numbers each (records only).
function fightsOver(exp: Expedition, n: number) {
  const teams = fightTeamsOf(exp);
  return tasksOf(exp).flatMap((task, i) =>
    Array.from({ length: n }, (_, k) => resolveTaskFight(exp, teams, exp.bodies[0], { ...task, fightCount: k, pointsCleared: 0 }, i)),
  );
}

describe("Field Kits conditions on a real run's fights", () => {
  // A hazardous body and a green rank 1 squad, so a Bruiser's strike can reach the heavy-hit line (a quarter of a
  // member's max HP).
  const base = handRun(crewed(0xf1e1d, (m) => m, 1), ["enemyFortification", "caveNetwork", "ancientRuins"], { ...CALM, combat: 4 }, false, 0.9);

  it("the flag-less run is untouched; its stamped twin's fights bring the new conditions home to the bay", () => {
    expect(fieldKitsLive(base)).toBe(false);
    const plain = fightsOver(base, 6);
    const flagged = fightsOver(kitted(base), 6);
    const seen = (records: typeof plain) => new Set(records.flatMap((r) => Object.values(r.memberConditions).flat()));
    for (const id of FIELD_KIT_STATUS_IDS) expect(seen(plain).has(id), id).toBe(false);
    const got = seen(flagged);
    expect([...got].some((id) => BONE_LINE.includes(id as never))).toBe(true);
    expect(got.has("concussion") || got.has("hemorrhage") || got.has("neurotoxin")).toBe(true);
    // Every carried condition is a bay condition (Fear and every buff end with the battle).
    for (const id of got) expect(Object.prototype.hasOwnProperty.call(GROUND_CONDITIONS, id), id).toBe(true);
    expect(got.has("fear")).toBe(false);
  });

  it("a stamped fight is deterministic and its log sink never changes the record", () => {
    const exp = kitted(base);
    const teams = fightTeamsOf(exp);
    const task = { ...tasksOf(exp)[0], fightCount: 2, pointsCleared: 0 };
    const log: GambitLogEvent[] = [];
    const a = resolveTaskFight(exp, teams, exp.bodies[0], task, 0);
    const b = resolveTaskFight(exp, teams, exp.bodies[0], task, 0, undefined, log);
    expect(b).toEqual(a);
    expect(log.length).toBeGreaterThan(0);
  });

  it("the bay times are the user's (N11), Stoneskin's longer; a carried bone condition rides into the next fight", () => {
    expect(memberBaySeconds(["fracture"], [], NO_CARE)).toBe(1800);
    expect(memberBaySeconds(["brokenBone"], [], NO_CARE)).toBe(3600);
    expect(memberBaySeconds(["shatteredBone"], [], NO_CARE)).toBe(7200);
    expect(memberBaySeconds(["fracture"], ["stoneskin"], NO_CARE)).toBe(2250);
    const exp = kitted(base);
    const id = exp.groundOps!.teams[0].securityIds[0];
    const team = taskFightTeam(exp, fightTeamsOf(exp), { id: "t", fightCount: 1 }, {
      [id]: { hp: 20, statuses: [{ id: "brokenBone", magnitude: 0.3, remaining: 9_000 }, { id: "fear", magnitude: 0.4, remaining: 1 }] },
    });
    expect(team.find((c) => c.memberId === id)!.statuses).toEqual([{ id: "brokenBone", magnitude: 0.3, remaining: 9_000 }]);
  });

  it("Stoneskin is stamped on Ossir members of a stamped run only", () => {
    const stone = handRun(crewed(0xf1e1d, (m) => ({ ...m, race: "ossir" })), ["caveNetwork"], CALM, false);
    const stamped = (e: Expedition) => taskFightTeam(e, fightTeamsOf(e), { id: "t", fightCount: 0 }).map((c) => c.stoneskin === true);
    expect(stamped(stone).every((x) => !x)).toBe(true);
    expect(stamped(kitted(stone)).every((x) => x)).toBe(true);
    expect(stamped(kitted(base)).every((x) => !x)).toBe(true);
  });

  it("Iron Will and Morale Anchor now change a stamped run's fights (Fear lands from Swarm and garrisons)", () => {
    const swarm = handRun(crewed(0x5a5a), ["caveNetwork", "enemyColony"], { ...CALM, combat: 3 }, true);
    const fingerprint = (e: Expedition) => JSON.stringify(fightsOver(e, 8));
    const ironWill = (e: Expedition): Expedition => ({
      ...e,
      roster: { ...e.roster!, security: e.roster!.security.map((m) => ({ ...m, resists: { ...m.resists, fear: 1 } })) },
    });
    expect(fingerprint(ironWill(swarm))).not.toBe(fingerprint(swarm));
    expect(fingerprint({ ...swarm, squadFearResist: 0.9 })).not.toBe(fingerprint(swarm));
    // Without the flag nothing inflicts Fear, so neither resist moves a fight.
    const plain = withoutFieldKits(swarm);
    expect(fingerprint(ironWill(plain))).toBe(fingerprint(plain));
    expect(fingerprint({ ...plain, squadFearResist: 0.9 })).toBe(fingerprint(plain));
  });

  it("the threat memo keys a stamped run apart; a flag-less key reads exactly as before", () => {
    const task = tasksOf(base)[0];
    const plainKey = groundThreatOddsKey(base, fightTeamsOf(base), base.bodies[0], task, 0, 32);
    expect(plainKey).not.toContain("fieldKits");
    const kitKey = groundThreatOddsKey(kitted(base), fightTeamsOf(base), base.bodies[0], task, 0, 32);
    expect(kitKey).not.toBe(plainKey);
    expect(kitKey.startsWith(plainKey.slice(0, -1))).toBe(true);
  });

  it("a stamped Deadly run: one call == 997 s chunks == 1 s steps", { timeout: 300_000 }, () => {
    const exp = handRun(crewed(0xf0f7), ["enemyFortification", "derelictOutpost"], { ...CALM, combat: 4 }, true);
    expect(tasksOf(exp)[0].difficulty).toBe(5);
    const end = T0 + 200_000;
    const one = advanceExpedition(exp, end);
    let e = exp;
    for (let t = T0 + 997; t < end; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, end)).toEqual(one);
    const H = T0 + 3 * 3600;
    let s = exp;
    for (let t = T0 + 1; t <= H; t += 1) s = advanceExpedition(s, t);
    expect(s).toEqual(advanceExpedition(exp, H));
    expect(advanceExpedition(s, end)).toEqual(one);
    // The stamped run's fights differ from its flag-less twin's (the conditions act).
    expect(JSON.stringify(advanceExpedition(withoutFieldKits(exp), end).groundOps)).not.toBe(JSON.stringify(one.groundOps));
  });
});
