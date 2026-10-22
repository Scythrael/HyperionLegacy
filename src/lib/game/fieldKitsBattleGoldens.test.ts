// Field Kits FKR-6 goldens (docs/plans/2026-10-14-field-kits-plan.md REVISED SLICES R3 FKR-6), captured on FKR-5's engine
// (e1d6d06) BEFORE any FKR-6 engine edit. FKR-0 and FK-3 already pin every run WITHOUT flag 2; these pin what a STAMPED
// run's fights did at FKR-5, so FKR-6 can prove "a stamped fight with no kits, no charges and no new rules equals the
// FKR-5 fight" and NAME the stamped fights it moves on purpose:
//   - THROW (a custom program that throws, no Use Item): must stay byte-identical (no kits are packed, no new rule).
//   - DECAPITATE (a preset with no Use Item and no throw): must stay byte-identical.
//   - DEFAULT (the built-in program): MOVES at FKR-6 on purpose (N15, user 2026-10-16 "the DEFAULT program throws them
//     sensibly, saving one for a Boss").
//   - TRIAGE (a preset whose kit-less Use Item spent the team kit): MOVES at FKR-6 on purpose (call 15, user 2026-10-17
//     "Means First Aid Kit": on a Field Kits run a Use Item spends the member's own First Aid Kits, and no pack rides in
//     before FKR-7, so the rule finds none).
// Each pin hashes two real fights (two objectives of a dispatched, hand-placed run) and a whole stamped run's ground
// operations after 200,000 s.

import { describe, expect, it } from "vitest";
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { freshState, type AwayMember, type BodyRiskGrades, type EquipmentInstance, type Expedition, type ExpeditionBody, type GambitProgram, type GameState, type ShipGroundTeam } from "./model";
import { gambitPresetPrograms } from "./gambit";
import { resolveTaskFight, type GroundFightTeam } from "./groundFight";
import { advanceExpedition, startExpedition } from "./expedition";
import { groundOpsAssignIdle, groundOpsBodyScanned, initGroundTasks } from "./groundOps";
import { plainAwayMember, withoutFieldKits } from "./awayTeamTestFixtures";
import { hash } from "./firstRunsGoldens.fixture";

// Field Kits catalog 1, pinned as a literal (timed grenades, 2026-10-21): these runs throw Stun and Toxin Grenades, and
// catalog 2 gives those a fuse, so the pins stay the catalog 1 run (a run in flight before the fuse), byte-identical.
const KITS = { catalog: 1 };
const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const CALM: BodyRiskGrades = { combat: 0, fauna: 0, flora: 0, hazard: 0 };
const GRENADIERS: Readonly<Record<string, string>> = { "member-1": "impactGrenade", "member-2": "stunGrenade", "member-4": "toxinGrenade" };

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

// Two ground teams; three members carry a grenade (each its own kind); a medic on each team; every Security member runs
// `program` (absent: the built-in default).
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
  const gear = Object.entries(GRENADIERS).map(([wearer, variety], i) => piece(`equip-${900 + i}`, variety, wearer));
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

// A dispatched run placed on one scanned body with `pois`, flag 2 stamped by hand (FKR-7 stamps it at dispatch).
function stampedRun(state: GameState, pois: string[], risk: BodyRiskGrades, hazard = 0.2): Expedition {
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
    fieldKits: KITS,
  });
  initGroundTasks(exp, 0);
  for (const team of exp.groundOps!.teams) team.stepStartedAt = T0;
  groundOpsBodyScanned(exp, 0, T0);
  groundOpsAssignIdle(exp, T0);
  return exp;
}

const fightTeamsOf = (exp: Expedition): GroundFightTeam[] =>
  exp.groundOps!.teams.map((t, i) => ({ securityIds: t.securityIds, downedThisTask: t.downedThisTask, securityShare: exp.groundOps!.factors.securityShare[i] }));

// Two real fights of the stamped run (each objective's first fight point, a fresh squad) and the whole run's ground
// operations after 200,000 s, hashed.
function pin(program: GambitProgram | undefined, seed: number): { fights: string; run: string } {
  const exp = stampedRun(crewed(seed, program), ["enemyColony", "derelictOutpost"], { ...CALM, combat: 3 });
  const fights = exp.bodies[0].activities.map((task, k) => resolveTaskFight(exp, fightTeamsOf(exp), exp.bodies[0], { ...task, fightCount: 0, pointsCleared: 0 }, k));
  return { fights: hash(fights), run: hash(advanceExpedition(exp, T0 + 200_000).groundOps) };
}

const THROW: GambitProgram = [{ target: "foeLargestGroup", action: "throwGrenade" }, { target: "foeHighestThreat", action: "attack" }, { target: "foeNearest", action: "attack" }];
const program = (id: string): GambitProgram => gambitPresetPrograms(id)!.security;

// Captured on FKR-5 (e1d6d06).
const FKR5_STAMPED_PINS = {
  throw: { fights: "768ca09e", run: "d05a966c" },
  decapitate: { fights: "d931b2e6", run: "df109462" },
  default: { fights: "352470e0", run: "53d86f60" },
  triage: { fights: "746a3eb3", run: "9f802a9c" },
} as const;

// MOVED AT FKR-6, named (see the header): the default program now throws (N15) and Triage's kit-less Use Item spends
// the member's own First Aid Kits, none packed before FKR-7 (call 15). Re-pinned on FKR-6.
const FKR6_MOVED_PINS: Partial<Record<keyof typeof FKR5_STAMPED_PINS, { fights: string; run: string }>> = {
  default: { fights: "a2808357", run: "d4ce6a8c" },
  triage: { fights: "f255b27a", run: "32c10f40" },
};

// MOVED AT FKR-7, named (fieldKitsRun.ts): a stamped run's grenade charges now carry from fight to fight within an
// objective (they reset only as the crew lands), so the two programs that THROW spend their charges down across an
// objective's fights instead of starting every fight full (FKR-5's "until then every fight starts full"). Each single
// fight (a fresh squad) is unchanged; only the whole run moves. Decapitate and Triage throw nothing, and a run stamped
// by hand carries no free basic set, so theirs stay put. Re-pinned on FKR-7.
const FKR7_MOVED_RUNS: Partial<Record<keyof typeof FKR5_STAMPED_PINS, string>> = {
  throw: "61fe73e6",
  default: "adb2d182",
};

describe("FKR-6 goldens: what a stamped run's fights did at FKR-5", () => {
  const cases: [keyof typeof FKR5_STAMPED_PINS, GambitProgram | undefined, number][] = [
    ["throw", THROW, 0xc4a2],
    ["decapitate", program("decapitate"), 0x51f3],
    ["default", undefined, 0xc4a2],
    ["triage", program("triage"), 0x2b77],
  ];
  for (const [name, prog, seed] of cases) {
    const moved = FKR6_MOVED_PINS[name];
    const run7 = FKR7_MOVED_RUNS[name];
    it(`${name}: two fights and a whole stamped run ${moved ? "MOVED on purpose at FKR-6" : "unchanged from FKR-5"}${run7 ? ", the run MOVED on purpose at FKR-7" : ""}`, { timeout: 120_000 }, () => {
      const got = pin(prog, seed);
      const before = moved ?? FKR5_STAMPED_PINS[name];
      if (moved) expect(got.fights).not.toBe(FKR5_STAMPED_PINS[name].fights);
      if (run7) expect(run7).not.toBe(before.run);
      expect(got).toEqual(run7 ? { ...before, run: run7 } : before);
    });
  }
});
