// E-CREW 0.14.0 (Task 16): INJURIES, NEURAL BACKUP, and DOWNED MEMBERS SIT OUT THE RUN.
//
// Covers:
//   - Neural Backup (D11): once per battle, the FIRST ally downed rolls 50% to revive at 30% HP, from its
//     OWN keyed stream. At most once per battle, never two members, and a battle without a holder
//     resolves exactly as before Task 16 (golden hashes captured before the change);
//   - the user rule (2026-10-07 / 2026-10-09): a member downed in ANY battle of a run (scan encounter,
//     activity battle, or an earlier attempt of the same task) sits out every later battle of that run;
//     offline == live with the rule in play;
//   - claim: every member downed during the run comes home injured (memberFallOutcome), recovery 2h
//     shortened by the Medical division share and Rapid Recovery (D23 curve, floor 15m), with a
//     per-member treatment hook for the Injury Kit (Task 16b);
//   - an injured member is excluded from the next dispatch snapshot and deploys again once recovered.
//
// Wiring OC-G1 (user 2026-10-16 "Delete it"): the legacy (pre-Ground-Ops) run rules are deleted, so the tests that
// pinned them are RETIRED with them, each having proved only the legacy path: "sits out the rest of the RUN" across
// legacy scan battles and activity battles (with its legacy parity run and fieldwork check), and the legacy claim's
// FLAT injury (the 2h recovery curve, its treatment hook, the claim injuring the downed, a fired member skipped).
// Ground Ops runs bring injuries home from the medical bay (groundOps*.test.ts, medicalBay.test.ts). What stays proves
// live rules: Neural Backup in the shared battle engine, the fall-outcome seam, the ship's care factors (the bay's
// frozen inputs), the dispatch snapshot leaving an injured member home, the recovery bar, and the save round-trip.

import { describe, it, expect } from "vitest";
import {
  freshState,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type GameState,
  type SeniorStaffOfficer,
} from "./model";
import { snapshotAwayRoster } from "./awayTeam";
import { buildRosterCombatants, generateEncounter, resolveGroundBattle, type GambitLogEvent, type GroundCombatant } from "./gambit";
import { makeRng } from "./combat/rng";
import { INJURY_BASE_RECOVERY_SECONDS, injuryRecoveredFraction, memberFallOutcome, shipInjuryFactors } from "./injuries";
import { deserialize, migrate, serialize } from "./save";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

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

function gearPiece(id: string, slotType: EquipmentInstance["slotType"], variety: string, wearer: string, implicit: Record<string, number> = {}): EquipmentInstance {
  return {
    id,
    slotType,
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: implicit,
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

const neuralBackup = (wearer: string): EquipmentInstance => gearPiece("equip-950", "implant", "neuralBackup", wearer, { groundHp: 12 });

function withRoster(members: AwayMember[], gear: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return { ...base, awayMembers: members, equipment: [...base.equipment, ...gear], nextAwayMemberId: 100 };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// The mixed three-member squad the golden battles were captured with (before Task 16 landed).
function goldenSquad(gear: EquipmentInstance[] = []): GameState {
  return withRoster(
    [
      member("member-1", "security", { spec: "offense", rank: 3, traits: ["quickDraw"] }),
      member("member-2", "security", { spec: "defense", rank: 2, traits: ["bulwark"] }),
      member("member-3", "security", { spec: "debuff", rank: 4, traits: ["fieldMedic"] }),
      member("member-4", "science"),
    ],
    gear,
  );
}

function goldenBattle(team: GroundCombatant[], seed: number, log?: GambitLogEvent[], reviveSeed?: number) {
  const enemies = generateEncounter(seed * 7919, (seed % 5) / 4, seed % 2 ? "subterraneanCivilization" : "ancientRuins");
  return resolveGroundBattle(team, enemies, 2, makeRng(seed * 31), log, reviveSeed);
}

// Hashes of { result, log } for 40 holder-less battles, captured from the code BEFORE Task 16.
const GOLDEN = [
  "9ee661a1", "3b72fffd", "518bb500", "e8132b9b", "7a5c516c", "6839b645", "53598358", "5c865992", "649cf55a", "3758537f",
  "74d83256", "60717c29", "ff290d79", "859034d3", "9fd7dce1", "ecfc8fb3", "c4718369", "61d14dc1", "3f271188", "a8ff8791",
  "57cc2535", "304dd0c6", "55ca174a", "80cb229", "41cc3f13", "392a801e", "10ac9c77", "f0f7f5a5", "c64df38e", "1cdefa63",
  "c76913a3", "f0988ecb", "1662d26a", "7202711f", "55f64df8", "5f99dee5", "80e9caab", "1c1c5e42", "ba85edb8", "e86a91bd",
];

// ============================================================================
describe("Neural Backup: determinism (no existing draw shifts)", () => {
  it("a battle with NO Neural Backup holder resolves exactly as before Task 16 (golden)", () => {
    const s = goldenSquad();
    const roster = snapshotAwayRoster(s, s.ships[0]);
    const got: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const team = buildRosterCombatants(roster.security, seed % 3 === 0 ? 30 : 0, "t");
      const log: GambitLogEvent[] = [];
      const res = goldenBattle(team, seed, log, seed * 101);
      got.push(fnv(JSON.stringify({ res, log })));
    }
    expect(got).toEqual(GOLDEN);
  });

  it("the snapshot carries the implant's revive effect onto the holder's combatant only", () => {
    const s = goldenSquad([neuralBackup("member-2")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    const team = buildRosterCombatants(roster.security, 0, "t");
    expect(team.map((c) => c.revive)).toEqual([undefined, { permille: 500, hpFraction: 0.3 }, undefined]);
  });

  it("when the backup's roll FAILS, the battle is the holder-less battle plus one log line (its own stream)", () => {
    const s = goldenSquad([neuralBackup("member-2")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    let failures = 0;
    let successes = 0;
    for (let seed = 1; seed <= 80; seed++) {
      for (const reviveSeed of [seed, seed * 977 + 13]) {
        const withHolder = buildRosterCombatants(roster.security, 0, "t");
        const control = buildRosterCombatants(roster.security, 0, "t").map((c) => {
          const copy = { ...c };
          delete copy.revive;
          return copy;
        });
        const logA: GambitLogEvent[] = [];
        const logB: GambitLogEvent[] = [];
        const a = goldenBattle(withHolder, seed, logA, reviveSeed);
        const b = goldenBattle(control, seed, logB, reviveSeed);
        if (a.neuralBackup && !a.neuralBackup.revived) {
          failures++;
          const { neuralBackup: _nb, ...rest } = a;
          expect(rest).toEqual(b);
          expect(logA.filter((e) => e.action !== "neuralBackup")).toEqual(logB);
          expect(logA.filter((e) => e.action === "neuralBackup")).toHaveLength(1);
        } else if (a.neuralBackup?.revived) {
          successes++;
        } else {
          // Nobody went down: the holder changes nothing at all.
          expect(a).toEqual(b);
          expect(logA).toEqual(logB);
        }
      }
    }
    // Roughly a coin flip, and both branches were exercised.
    expect(failures).toBeGreaterThan(5);
    expect(successes).toBeGreaterThan(5);
  });
});

// ============================================================================
describe("Neural Backup: once per battle, the first ally downed, at 30% HP", () => {
  it("fires at most once per battle, never on two members, and revives the FIRST ally downed", () => {
    const s = goldenSquad([neuralBackup("member-1")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    let revived = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const team = buildRosterCombatants(roster.security, 0, "t");
      const log: GambitLogEvent[] = [];
      const res = goldenBattle(team, seed, log, seed ^ 0x55);
      const nb = log.filter((e) => e.action === "neuralBackup");
      expect(nb.length).toBeLessThanOrEqual(1);
      if (nb.length === 0) {
        expect(res.neuralBackup).toBeUndefined();
        continue;
      }
      // The roll targets the first team member the log shows going down (a damage-over-time down is not a
      // logged action, so only a down logged BEFORE the roll is checked).
      const nbAt = log.indexOf(nb[0]);
      const firstDown = log.slice(0, nbAt).find((e) => e.downed && e.targetSide === "team");
      if (firstDown) expect(nb[0].targetMemberId).toBe(firstDown.targetMemberId);
      expect(res.neuralBackup?.memberId).toBe(nb[0].targetMemberId);
      if (res.neuralBackup!.revived) {
        revived++;
        const c = team.find((x) => x.memberId === nb[0].targetMemberId)!;
        expect(nb[0].hpDelta).toBe(Math.max(1, Math.round(c.hpMax * 0.3)));
      } else {
        expect(nb[0].missed).toBe(true);
      }
    }
    expect(revived).toBeGreaterThan(0);
  });

  it("a revived member who stays up is NOT listed as downed at the battle's end", () => {
    const s = goldenSquad([neuralBackup("member-1")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    let checked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const team = buildRosterCombatants(roster.security, 0, "t");
      const res = goldenBattle(team, seed, undefined, seed);
      if (!res.neuralBackup?.revived) continue;
      const c = team.find((x) => x.memberId === res.neuralBackup!.memberId)!;
      expect(res.downedMemberIds.includes(c.memberId!)).toBe(c.downed);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("is deterministic: same inputs, same battle", () => {
    const s = goldenSquad([neuralBackup("member-1")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    for (let seed = 1; seed <= 20; seed++) {
      const logA: GambitLogEvent[] = [];
      const logB: GambitLogEvent[] = [];
      const a = goldenBattle(buildRosterCombatants(roster.security, 0, "t"), seed, logA, 7);
      const b = goldenBattle(buildRosterCombatants(roster.security, 0, "t"), seed, logB, 7);
      expect(a).toEqual(b);
      expect(logA).toEqual(logB);
    }
  });
});

// ============================================================================
describe("injuries: the fall seam, the ship's care, the dispatch snapshot, the recovery bar", () => {
  it("memberFallOutcome is 'injured' (the Safety Interlock branch comes later)", () => {
    expect(memberFallOutcome({ memberId: "member-1", expeditionId: "expedition-1" })).toBe("injured");
  });

  it("shipInjuryFactors reads the Medical division (Reduced Crew Losses) and the Rapid Recovery officer", () => {
    const s = freshState();
    expect(shipInjuryFactors(s, s.ships[0])).toEqual({ medicalShare: 0, rapidRecoveryShare: 0 });
    const medic: SeniorStaffOfficer = {
      id: "officer-1",
      seat: "medical",
      name: "Doc",
      race: "earthBorn",
      gender: "nonbinary",
      rank: "ensign",
      bonuses: [{ id: "med.recovery", magnitude: 0.1 }, { id: "med.fleetTriage", magnitude: 0.15 }],
      missionsCompleted: 0,
      assignedShipId: "ship-1",
    };
    const withOfficer = { ...s, officers: [medic] };
    expect(shipInjuryFactors(withOfficer, s.ships[0]).rapidRecoveryShare).toBeCloseTo(0.1);
    // Fleet Triage is the in-battle healing bonus, never injury length.
    expect(shipInjuryFactors(withOfficer, s.ships[0]).medicalShare).toBe(0);
    const ship = {
      ...s.ships[0],
      complement: {
        mode: "passive" as const,
        buckets: [{ profession: "medical" as const, rarity: "standard" as const, rank: 3 as const, race: "earthBorn" as const, buff1Id: "med.reducedLosses", buff2Id: null, count: 20 }],
      },
    };
    const withMed = { ...s, ships: [ship] };
    expect(shipInjuryFactors(withMed, ship).medicalShare).toBeGreaterThan(0);
  });

  it("an injured member is excluded from the next dispatch snapshot, and deploys again once recovered", () => {
    // OC-G1: the injury is written as a claim writes it (injuredUntilSeconds / injuredAtSeconds), not by the deleted
    // legacy claim.
    const s = withRoster([member("member-1", "security"), member("member-3", "security"), member("member-2", "science")]);
    const next: GameState = {
      ...s,
      gameTimeSeconds: 1000,
      awayMembers: s.awayMembers.map((m) => (m.id === "member-1" ? { ...m, injuredUntilSeconds: 1000 + INJURY_BASE_RECOVERY_SECONDS, injuredAtSeconds: 1000 } : m)),
    };
    const snapNow = snapshotAwayRoster(next, next.ships[0]);
    expect(snapNow.security.map((m) => m.memberId)).toEqual(["member-3"]);
    const later = { ...next, gameTimeSeconds: 1000 + INJURY_BASE_RECOVERY_SECONDS };
    expect(snapshotAwayRoster(later, later.ships[0]).security.map((m) => m.memberId)).toEqual(["member-1", "member-3"]);
  });

  it("the recovery bar reads the stored span; an old injury without a start falls back to the 2h base", () => {
    expect(injuryRecoveredFraction({ injuredAtSeconds: 1000, injuredUntilSeconds: 2000 }, 1500)).toBeCloseTo(0.5);
    expect(injuryRecoveredFraction({ injuredAtSeconds: 1000, injuredUntilSeconds: 2000 }, 2500)).toBe(1);
    expect(injuryRecoveredFraction({ injuredUntilSeconds: 3600 }, 0)).toBeCloseTo(0.5);
    expect(injuryRecoveredFraction({}, 0)).toBe(1);
  });
});

// ============================================================================
describe("save: the Task 16 fields are optional and round-trip with no SAVE_VERSION bump", () => {
  // OC-G1: the legacy task's downed list went with the legacy resolver; the member's injury fields stay live.
  it("an injured member's start survives serialize -> load", () => {
    const base = withRoster([member("member-1", "security"), member("member-3", "security"), member("member-2", "science")]);
    const s: GameState = {
      ...base,
      awayMembers: base.awayMembers.map((m) => (m.id === "member-1" ? { ...m, injuredUntilSeconds: 9000, injuredAtSeconds: 1800 } : m)),
    };
    const loaded = migrate(deserialize(serialize(s, 0))!);
    expect(loaded.awayMembers.find((m) => m.id === "member-1")).toMatchObject({ injuredUntilSeconds: 9000, injuredAtSeconds: 1800 });
  });
});
