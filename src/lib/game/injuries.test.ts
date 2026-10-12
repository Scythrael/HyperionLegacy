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

import { describe, it, expect } from "vitest";
import {
  freshState,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type SeniorStaffOfficer,
} from "./model";
import { snapshotAwayRoster } from "./awayTeam";
import {
  activityDownedBefore,
  buildRosterCombatants,
  deriveExpeditionActivityLog,
  deriveScanEncounterLog,
  expeditionDownedMemberIds,
  generateEncounter,
  resolveExpeditionActivity,
  resolveGroundBattle,
  scanDownedBefore,
  type GambitLogEvent,
  type GroundCombatant,
} from "./gambit";
import { makeRng } from "./combat/rng";
import {
  advanceExpedition,
  claimExpedition,
  expeditionCandidates,
  scanEncounterChance,
  scanStepRoll,
  startExpedition,
} from "./expedition";
import {
  INJURY_BASE_RECOVERY_SECONDS,
  INJURY_MIN_RECOVERY_SECONDS,
  applyExpeditionInjuries,
  injuryRecoveredFraction,
  injuryRecoverySeconds,
  memberFallOutcome,
  shipInjuryFactors,
} from "./injuries";
import { fieldworkEffect } from "./fieldwork";
import { deserialize, migrate, serialize } from "./save";

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
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

const neuralBackup = (wearer: string): EquipmentInstance => gearPiece("equip-950", "implant", "neuralBackup", wearer, { groundHp: 12 });
const lure = (id: string, wearer: string): EquipmentInstance => gearPiece(id, "memberTool", "lureBeacon", wearer);

function withRoster(members: AwayMember[], gear: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return { ...base, awayMembers: members, equipment: [...base.equipment, ...gear], nextAwayMemberId: 100 };
}

const BIG = 1_000_000;

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

// A dispatched run (startExpedition: the real roster snapshot, every phase) whose completed form satisfies
// `pred`, searched over the per-save expedition seed. Throws when none does (a vacuous test fails loudly).
function findRun(base: GameState, pred: (done: Expedition) => boolean, limit = 400): { state: GameState; start: Expedition; done: Expedition } {
  for (let i = 0; i < limit; i++) {
    const s = { ...base, expeditionSeed: (0x2468ace + i * 7919) >>> 0 };
    const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    if (!res.success) continue;
    const done = advanceExpedition(res.expedition!, BIG);
    if (pred(done)) return { state: res.next, start: res.expedition!, done };
  }
  throw new Error("no run satisfied the precondition");
}

// Every activity of a run with its flat index (the resolver's globalIndex).
function flatActivities(exp: Expedition) {
  const out: { body: Expedition["bodies"][number]; act: Expedition["bodies"][number]["activities"][number]; index: number }[] = [];
  let i = 0;
  for (const body of exp.bodies) for (const act of body.activities) out.push({ body, act, index: i++ });
  return out;
}

const membersIn = (events: GambitLogEvent[]): Set<string> => {
  const ids = new Set<string>();
  for (const e of events) {
    if (e.memberId) ids.add(e.memberId);
    if (e.targetMemberId) ids.add(e.targetMemberId);
  }
  return ids;
};

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
describe("a downed member SITS OUT the rest of the run", () => {
  // Two Security members (each with a Lure Beacon to raise the encounter count) and one Science member.
  const base = withRoster(
    [member("member-1", "security"), member("member-3", "security"), member("member-2", "science")],
    [lure("equip-901", "member-1"), lure("equip-902", "member-3")],
  );

  it("scan encounters: a member downed at an earlier boundary fights no later encounter", () => {
    const { done } = findRun(base, (e) => {
      const evs = (e.scanEvents ?? []).filter((x) => x.kind === "encounter");
      const firstDown = evs.findIndex((x) => (x.downedMemberIds ?? []).length > 0 && x.downedMemberIds!.length < 2);
      return firstDown >= 0 && evs.length > firstDown + 1;
    });
    const evs = (done.scanEvents ?? []).filter((x) => x.kind === "encounter");
    let out = new Set<string>();
    let laterChecked = 0;
    for (const ev of evs) {
      expect(scanDownedBefore(done, ev.bodyIndex, ev.step)).toEqual(out);
      const log = deriveScanEncounterLog(done, ev.bodyIndex, ev.step)!;
      expect(log.outcome).toBe(ev.outcome);
      for (const id of out) {
        expect(membersIn(log.events).has(id)).toBe(false);
        laterChecked++;
      }
      // Nobody already out can be listed as downed again.
      for (const id of ev.downedMemberIds ?? []) expect(out.has(id)).toBe(false);
      out = new Set([...out, ...(ev.downedMemberIds ?? [])]);
    }
    expect(laterChecked).toBeGreaterThan(0);
  });

  it("activity battles: members downed while scanning or in an earlier task never fight a later task", () => {
    const { done } = findRun(base, (e) => {
      const scanDowned = (e.scanEvents ?? []).some((x) => (x.downedMemberIds ?? []).length === 1);
      return scanDowned && flatActivities(e).length >= 2;
    });
    const acts = flatActivities(done);
    let out = new Set<string>();
    for (const ev of done.scanEvents ?? []) for (const id of ev.downedMemberIds ?? []) out.add(id);
    expect(out.size).toBeGreaterThan(0);
    for (const { body, act, index } of acts) {
      expect(activityDownedBefore(done, index)).toEqual(out);
      const log = deriveExpeditionActivityLog(done, body, act, index);
      for (const id of out) expect(membersIn(log.events).has(id)).toBe(false);
      // The stored finding agrees with the re-derived outcome (the re-derivation reads the same cutoff).
      const stored = done.findings.find((f) => f.id.endsWith(act.id))!;
      expect(stored.evacuated === true).toBe(log.outcome === "evacuated");
      for (const id of act.downedMemberIds ?? []) expect(out.has(id)).toBe(false);
      out = new Set([...out, ...(act.downedMemberIds ?? [])]);
    }
    expect(expeditionDownedMemberIds(done).sort()).toEqual([...out].sort());
  });

  it("with the whole Security squad out, no later encounter rolls and tasks evacuate without a battle", () => {
    const solo = withRoster([member("member-1", "security"), member("member-2", "science")], [lure("equip-901", "member-1")]);
    const { done } = findRun(solo, (e) => (e.scanEvents ?? []).some((x) => x.kind === "encounter" && x.outcome === "loss"));
    const evs = done.scanEvents ?? [];
    const lossAt = evs.findIndex((x) => x.kind === "encounter" && x.outcome === "loss");
    expect(evs[lossAt].downedMemberIds).toEqual(["member-1"]);
    // Every later boundary has a 0 encounter chance (the only Security member is out).
    for (const ev of evs.slice(lossAt + 1)) expect(ev.kind).toBe("supplyCache");
    const lossEv = evs[lossAt];
    const body = done.bodies[lossEv.bodyIndex];
    expect(scanEncounterChance(done, body, scanDownedBefore(done, lossEv.bodyIndex, lossEv.step + 1))).toBe(0);
    expect(scanStepRoll(done, lossEv.bodyIndex, lossEv.step).encounter).toBe(true); // its own boundary still did
    // Every ground task evacuated with no battle at all.
    for (const { body: b, act, index } of flatActivities(done)) {
      const res = resolveExpeditionActivity(done, b, act, index);
      expect(res.outcome).toBe("evacuated");
      expect(res.attempts).toBe(0);
      expect(res.downedMemberIds).toEqual([]);
    }
  });

  it("an earlier ATTEMPT counts too: a lone member wiped in attempt 1 cannot retry, the task evacuates", () => {
    const solo = withRoster([member("member-1", "security"), member("member-2", "science")]);
    const { done } = findRun(solo, (e) =>
      (e.scanEvents ?? []).every((x) => (x.downedMemberIds ?? []).length === 0) &&
      flatActivities(e).some(({ act }) => (act.downedMemberIds ?? []).length > 0),
    );
    const hit = flatActivities(done).find(({ act }) => (act.downedMemberIds ?? []).length > 0)!;
    const res = resolveExpeditionActivity(done, hit.body, hit.act, hit.index);
    // A lone member down is a wipe: the task is lost, and with nobody left there is no second attempt
    // (before Task 16 the same member stood back up for attempts 2 and 3).
    expect(res.downedMemberIds).toEqual(["member-1"]);
    expect(res.outcome).toBe("evacuated");
    expect(res.attempts).toBe(1);
    // ...and every later task evacuates without a battle.
    for (const later of flatActivities(done).filter((x) => x.index > hit.index)) {
      expect(resolveExpeditionActivity(done, later.body, later.act, later.index).attempts).toBe(0);
    }
  });

  it("fieldwork: Science never fights so never sits out, and a downed Security member never did fieldwork", () => {
    const { done, start } = findRun(base, (e) => expeditionDownedMemberIds(e).length > 0 && flatActivities(e).length > 0);
    for (const { body, act } of flatActivities(done)) {
      expect(fieldworkEffect(done, body.planetType, act.poiId)).toEqual(fieldworkEffect(start, body.planetType, act.poiId));
    }
    for (const id of expeditionDownedMemberIds(done)) expect(done.roster!.science.some((m) => m.memberId === id)).toBe(false);
  });

  it("PARITY: one big advance == many small advances with sit-outs and Neural Backup in play", () => {
    const gear = [lure("equip-901", "member-1"), lure("equip-902", "member-3"), neuralBackup("member-3")];
    const s0 = withRoster([member("member-1", "security"), member("member-3", "security"), member("member-2", "science")], gear);
    const { start, done } = findRun(s0, (e) => {
      const downedScan = (e.scanEvents ?? []).some((x) => (x.downedMemberIds ?? []).length > 0);
      return downedScan && flatActivities(e).length >= 2 && e.bodies.length > 1;
    });
    let small = start;
    for (let t = start.phaseAnchorSeconds; t <= start.phaseAnchorSeconds + 200_000; t += 89) small = advanceExpedition(small, t);
    small = advanceExpedition(small, BIG);
    expect(done.phase).toBe("complete");
    expect(small).toEqual(done);
  });
});

// ============================================================================
describe("injuries at claim", () => {
  it("memberFallOutcome is 'injured' (the Safety Interlock branch comes later)", () => {
    expect(memberFallOutcome({ memberId: "member-1", expeditionId: "expedition-1" })).toBe("injured");
  });

  it("recovery: 2h base, shortened by Medical and Rapid Recovery on a diminishing curve, floor 15m", () => {
    const none = { medicalShare: 0, rapidRecoveryShare: 0 };
    expect(injuryRecoverySeconds(none)).toBe(INJURY_BASE_RECOVERY_SECONDS);
    expect(INJURY_BASE_RECOVERY_SECONDS).toBe(7200);
    expect(INJURY_MIN_RECOVERY_SECONDS).toBe(900);
    const med = injuryRecoverySeconds({ medicalShare: 0.1, rapidRecoveryShare: 0 });
    const rapid = injuryRecoverySeconds({ medicalShare: 0, rapidRecoveryShare: 0.1 });
    const both = injuryRecoverySeconds({ medicalShare: 0.1, rapidRecoveryShare: 0.1 });
    expect(med).toBeLessThan(7200);
    expect(rapid).toBe(med); // the two shares stack additively
    expect(both).toBeLessThan(med);
    // Each extra share point saves less time than the one before (diminishing, never a cliff).
    expect(7200 - med).toBeGreaterThan(med - both);
    expect(injuryRecoverySeconds({ medicalShare: 50, rapidRecoveryShare: 50 })).toBe(INJURY_MIN_RECOVERY_SECONDS);
    // Negative shares never lengthen the injury past the base.
    expect(injuryRecoverySeconds({ medicalShare: -1, rapidRecoveryShare: 0 })).toBe(7200);
  });

  it("the per-member treatment hook (the Injury Kit, Task 16b) shortens one member's recovery", () => {
    const f = { medicalShare: 0.05, rapidRecoveryShare: 0 };
    expect(injuryRecoverySeconds(f, 0.25)).toBeLessThan(injuryRecoverySeconds(f));
    expect(injuryRecoverySeconds(f, 0)).toBe(injuryRecoverySeconds(f));
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

  it("claim injures every member downed during the run (and only them), timed by the ship's Medical", () => {
    const base = withRoster(
      [member("member-1", "security"), member("member-3", "security"), member("member-2", "science")],
      [lure("equip-901", "member-1"), lure("equip-902", "member-3")],
    );
    const { state, done } = findRun(base, (e) => expeditionDownedMemberIds(e).length === 1);
    const now = 123_456;
    const s = { ...state, gameTimeSeconds: now, expeditions: state.expeditions.map((e) => (e.id === done.id ? done : e)) };
    const res = claimExpedition(s, done.id);
    expect(res.success).toBe(true);
    const downed = expeditionDownedMemberIds(done);
    expect(res.injuries!.map((i) => i.memberId)).toEqual(downed);
    for (const m of res.next.awayMembers) {
      if (downed.includes(m.id)) {
        expect(m.injuredUntilSeconds).toBe(now + INJURY_BASE_RECOVERY_SECONDS);
        expect(m.injuredAtSeconds).toBe(now);
      } else {
        expect(m.injuredUntilSeconds).toBeUndefined();
        expect(m.injuredAtSeconds).toBeUndefined();
      }
    }

    // A Rapid Recovery officer on the ship shortens the new timer.
    const medic: SeniorStaffOfficer = {
      id: "officer-1", seat: "medical", name: "Doc", race: "earthBorn", gender: "nonbinary", rank: "ensign",
      bonuses: [{ id: "med.recovery", magnitude: 0.2 }, { id: "med.fleetTriage", magnitude: 0.15 }], missionsCompleted: 0, assignedShipId: "ship-1",
    };
    const res2 = claimExpedition({ ...s, officers: [medic] }, done.id);
    const hurt = res2.next.awayMembers.find((m) => m.id === downed[0])!;
    expect(hurt.injuredUntilSeconds! - now).toBe(injuryRecoverySeconds({ medicalShare: 0, rapidRecoveryShare: 0.2 }));
    expect(hurt.injuredUntilSeconds! - now).toBeLessThan(INJURY_BASE_RECOVERY_SECONDS);
  });

  it("an injured member is excluded from the next dispatch snapshot, and deploys again once recovered", () => {
    const s = withRoster([member("member-1", "security"), member("member-3", "security"), member("member-2", "science")]);
    const fake: Expedition = { ...findRun(s, () => true).done, scanEvents: [{ bodyIndex: 0, step: 3, kind: "encounter", outcome: "loss", downedMemberIds: ["member-1"], pauseSeconds: 10 }] };
    const st = { ...s, gameTimeSeconds: 1000 };
    const { next, injuries } = applyExpeditionInjuries(st, fake);
    expect(injuries.map((i) => i.memberId)).toEqual(["member-1"]);
    const snapNow = snapshotAwayRoster(next, next.ships[0]);
    expect(snapNow.security.map((m) => m.memberId)).toEqual(["member-3"]);
    const later = { ...next, gameTimeSeconds: 1000 + INJURY_BASE_RECOVERY_SECONDS };
    expect(snapshotAwayRoster(later, later.ships[0]).security.map((m) => m.memberId)).toEqual(["member-1", "member-3"]);
  });

  it("a fired member (gone from the roster) is skipped; no downs leaves the state untouched", () => {
    const s = withRoster([member("member-3", "security"), member("member-2", "science")]);
    const fake = { ...findRun(withRoster([member("member-1", "security"), member("member-2", "science")]), () => true).done };
    const withDown: Expedition = { ...fake, scanEvents: [{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "loss", downedMemberIds: ["member-1"], pauseSeconds: 5 }] };
    expect(applyExpeditionInjuries(s, withDown)).toEqual({ next: s, injuries: [] });
    const clean: Expedition = { ...fake, scanEvents: [], bodies: fake.bodies.map((b) => ({ ...b, activities: b.activities.map((a) => ({ ...a, downedMemberIds: undefined })) })) };
    expect(applyExpeditionInjuries(s, clean).next).toBe(s);
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
  it("an injured member's start and a task's downed list survive serialize -> load", () => {
    const base = withRoster(
      [member("member-1", "security"), member("member-3", "security"), member("member-2", "science")],
      [lure("equip-901", "member-1"), lure("equip-902", "member-3")],
    );
    const { state, done } = findRun(base, (e) => flatActivities(e).some(({ act }) => (act.downedMemberIds ?? []).length > 0));
    const s: GameState = {
      ...state,
      expeditions: state.expeditions.map((e) => (e.id === done.id ? done : e)),
      awayMembers: state.awayMembers.map((m) => (m.id === "member-1" ? { ...m, injuredUntilSeconds: 9000, injuredAtSeconds: 1800 } : m)),
    };
    const loaded = migrate(deserialize(serialize(s, 0))!);
    expect(loaded.awayMembers.find((m) => m.id === "member-1")).toMatchObject({ injuredUntilSeconds: 9000, injuredAtSeconds: 1800 });
    const exp = loaded.expeditions.find((e) => e.id === done.id)!;
    expect(expeditionDownedMemberIds(exp)).toEqual(expeditionDownedMemberIds(done));
  });
});
