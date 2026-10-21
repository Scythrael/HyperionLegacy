// Timed grenades goldens (user 2026-10-21, recipe realism audit call 11 and merge-batch answers "Timed grenades fuse":
// "1 round later (Recommended)"), captured on f566e22 BEFORE any fuse engine edit. Kits are live (FIELD_KITS_RUNS_LIVE),
// so runs stamped with Field Kits catalog 1 may be in flight on staging: the fuse rides a NEW catalog version (2), and a
// catalog 1 run must resolve byte-identically after it. These pin, on the same hand-placed run (two ground teams, three
// grenadiers: Impact on member-1, Stun on member-2, Toxin on member-4, a program that throws at the largest group):
//   - CATALOG 1 (the in-flight run): two real fights (records AND battle logs) and the whole run's ground operations.
//     Must stay byte-identical across the fuse.
//   - CATALOG 2 stamped by hand: identical to catalog 1 before the fuse (the engine read any catalog the same); the fuse
//     MOVED it on purpose (Stun and Toxin now detonate at the start of the thrower's next turn), named at
//     FUSE_MOVED_PINS.
//   - IMPACT ONLY on catalog 2: the Impact Grenade is the default and detonates on contact, so a squad whose only
//     grenade is an Impact Grenade must stay byte-identical across the fuse even on the new catalog.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionBody, type GambitProgram, type GameState, type ShipGroundTeam } from "./model";
import type { GambitLogEvent } from "./gambit";
import { resolveTaskFight, type GroundFightTeam } from "./groundFight";
import { advanceExpedition, startExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { plainAwayMember, withoutFieldKits } from "./awayTeamTestFixtures";
import { hash } from "./firstRunsGoldens.fixture";

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const ALL_THREE: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-2": "stunGrenade", "member-4": "toxinGrenade" };
const IMPACT_ONLY: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-4": "impactGrenade" };
const THROW: GambitProgram = [{ target: "foeLargestGroup", action: "throwGrenade" }, { target: "foeHighestThreat", action: "attack" }, { target: "foeNearest", action: "attack" }];

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
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

function crewed(expeditionSeed: number, grenadiers: Readonly<Record<string, string>>): GameState {
  const base = freshState();
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const member = (id: string, teamType: AwayMember["teamType"]): AwayMember => ({
    ...plainAwayMember(id, teamType, "ship-1"),
    rank: 3,
    ...(teamType === "security" ? { gambit: THROW.map((r) => ({ ...r })) } : {}),
  });
  const gear = Object.entries(grenadiers).map(([wearer, variety], i) => piece(`equip-${900 + i}`, variety, wearer));
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

// A dispatched run placed on one scanned body with `pois`, Field Kits stamped by hand with `catalog`.
function stampedRun(state: GameState, catalog: number, pois: string[], risk: BodyRiskGrades): Expedition {
  const res = startExpedition(state, "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const d = withoutFieldKits(res.expedition);
  const body: ExpeditionBody = {
    id: "body-1",
    planetType: "terrestrial",
    scanTotal: 100,
    scanProgress: 100,
    hazard: 0.2,
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
    fieldKits: { catalog },
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const fightTeamsOf = (exp: Expedition): GroundFightTeam[] =>
  exp.groundOps!.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i] }));

interface FusePin {
  fights: string;
  logs: string;
  run: string;
}

// Two real fights (each objective's first fight point, a fresh squad, with their battle logs) and the whole run's
// ground operations after 200,000 s, hashed.
function fusePin(seed: number, catalog: number, grenadiers: Readonly<Record<string, string>>): FusePin {
  const exp = stampedRun(crewed(seed, grenadiers), catalog, ["enemyColony", "derelictOutpost"], { ...CALM, combat: 3 });
  const logs: GambitLogEvent[][] = [];
  const fights = exp.bodies[0].activities.map((task, k) => {
    const log: GambitLogEvent[] = [];
    const rec = resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], { ...task, fightCount: 0, pointsCleared: 0 }, k, undefined, log);
    logs.push(log);
    return rec;
  });
  return { fights: hash(fights), logs: hash(logs), run: hash(advanceExpedition(exp, T0 + 200_000).groundOps) };
}

const FUSE_SEEDS = [0xc4a2, 0x51f3] as const;

// Captured on f566e22 (before the fuse): catalog 1 with all three grenades, per seed.
// (Seed c4a2's fights and run equal fieldKitsBattleGoldens.test.ts's THROW pins: the same squad and program.)
const PRE_FUSE_PINS: Readonly<Record<number, FusePin>> = {
  [0xc4a2]: { fights: "768ca09e", logs: "f5f27f14", run: "61fe73e6" },
  [0x51f3]: { fights: "76e5d9a8", logs: "fa02ce6", run: "ae50a2d1" },
};
// Captured on f566e22: catalog 2 with Impact Grenades only, per seed.
const PRE_FUSE_IMPACT_PINS: Readonly<Record<number, FusePin>> = {
  [0xc4a2]: { fights: "e22de159", logs: "abca56a4", run: "f99c747e" },
  [0x51f3]: { fights: "c8cd0f85", logs: "b08504a7", run: "aaaf9bbd" },
};

// MOVED AT THE FUSE, named: on catalog 2 the Stun (member-2) and Toxin (member-4) throws prime and detonate at the start
// of the thrower's next turn, on the foes of the target's group still standing that did not move clear (their own fuse
// stream), so the fights, their logs (the "primed" throw and the "grenadeDetonates" line) and the whole run move. The
// catalog 1 pins above (the run in flight) and the Impact-only pins did not move. Re-pinned on the fuse commit.
const FUSE_MOVED_PINS: Readonly<Record<number, FusePin>> = {
  [0xc4a2]: { fights: "8d41a541", logs: "eeb06573", run: "bbf12561" },
  [0x51f3]: { fights: "f8973571", logs: "cd3b7cff", run: "6cde560a" },
};

// The members who threw in the two pinned fights (the pins must cover a Stun and a Toxin throw, not only the Impact).
function throwersOf(seed: number, catalog: number): string[] {
  const exp = stampedRun(crewed(seed, ALL_THREE), catalog, ["enemyColony", "derelictOutpost"], { ...CALM, combat: 3 });
  const out = new Set<string>();
  exp.bodies[0].activities.forEach((task, k) => {
    const log: GambitLogEvent[] = [];
    resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], { ...task, fightCount: 0, pointsCleared: 0 }, k, undefined, log);
    for (const ev of log) if (ev.action === "throwGrenade" && ev.memberId) out.add(ev.memberId);
  });
  return [...out].sort();
}

describe("timed grenades goldens: what a stamped run's grenades did before the fuse", () => {
  for (const seed of FUSE_SEEDS) {
    it(`seed ${seed.toString(16)}: a catalog 1 run (in flight) with Impact, Stun and Toxin throws`, { timeout: 120_000 }, () => {
      expect(fusePin(seed, 1, ALL_THREE)).toEqual(PRE_FUSE_PINS[seed]);
      expect(throwersOf(seed, 1)).toEqual(["member-1", "member-2", "member-4"]);
    });
    it(`seed ${seed.toString(16)}: a catalog 2 run with all three grenades MOVED on purpose at the fuse (named below)`, { timeout: 120_000 }, () => {
      const got = fusePin(seed, 2, ALL_THREE);
      expect(got.fights).not.toBe(PRE_FUSE_PINS[seed].fights);
      expect(got.logs).not.toBe(PRE_FUSE_PINS[seed].logs);
      expect(got).toEqual(FUSE_MOVED_PINS[seed]);
    });
    it(`seed ${seed.toString(16)}: a catalog 2 run with Impact Grenades only (contact, unchanged by the fuse)`, { timeout: 120_000 }, () => {
      expect(fusePin(seed, 2, IMPACT_ONLY)).toEqual(PRE_FUSE_IMPACT_PINS[seed]);
    });
  }
});
