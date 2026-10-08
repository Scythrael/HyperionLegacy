// E-CREW 0.14.0 (Task 14): RANDOM ENCOUNTERS during scan progress (design D10).
//
// Covers:
//   - the chance formula: base by hazard, the Shroud / Lure dial, Evasive Command, the clamp;
//   - D20: the field-device multiplier is applied to every device bias (one tunable number);
//   - every interior step boundary rolls exactly once, however the advance is chunked;
//   - a win adds the enemy drops; a loss pauses the body's scan until the next activity window, then
//     the scan resumes; downed members are recorded;
//   - the supply-cache event is the step roll's second draw and only counts without an encounter;
//   - Evasive Command is snapshotted at dispatch from the pilot officer;
//   - offline == live with a real roster, including an encounter and a loss pause;
//   - neutrality: an expedition dispatched before Task 14 (no encounterSteps) scans exactly as before.

import { describe, it, expect } from "vitest";
import {
  freshState,
  type AwayMember,
  type AwayTeamType,
  type EquipmentInstance,
  type Expedition,
  type ExpeditionBody,
  type GameState,
  type SeniorStaffOfficer,
} from "./model";
import {
  advanceExpedition,
  encounterChance,
  expeditionCandidates,
  fieldDeviceEffectiveness,
  nextActivityWindow,
  scanEncounterChance,
  scanStepRoll,
  squadEncounterBias,
  startExpedition,
  ACTIVITY_SECONDS,
  ENCOUNTER_BASE_CHANCE,
  ENCOUNTER_CHANCE_MAX,
  ENCOUNTER_HAZARD_CHANCE,
  ENCOUNTER_STEPS,
  FIELD_DEVICE_UNTRAINED_EFFECTIVENESS,
} from "./expedition";
import { snapshotAwayRoster } from "./awayTeam";
import { officerBonusTotal } from "./crewOverlay";
import {
  resolveGroundBattle,
  resolveScanEncounter,
  rollSupplyCache,
  buildRosterCombatants,
  deriveScanEncounterLog,
  generateEncounter,
} from "./gambit";
import { makeRng } from "./combat/rng";

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

// A crafted member Tool worn by `wearer` (Shroud Emitter / Lure Beacon are memberTool varieties).
function tool(id: string, variety: string, wearer: string): EquipmentInstance {
  return {
    id,
    slotType: "memberTool",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "bp-test",
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

function withRoster(members: AwayMember[], gear: EquipmentInstance[] = []): GameState {
  const base = freshState();
  return { ...base, awayMembers: members, equipment: [...base.equipment, ...gear], nextAwayMemberId: 100 };
}

const plainSquad = (): AwayMember[] => [member("member-1", "security"), member("member-2", "science")];

// A hand-built single-body expedition carrying a real roster snapshot (phaseAnchorSeconds 0, so
// nowSeconds == elapsed-in-scanning). Encounters are enabled (encounterSteps set).
function scanExp(state: GameState, over: Partial<Expedition> = {}, body: Partial<ExpeditionBody> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "scanning",
    phaseAnchorSeconds: 0,
    shakedown: false,
    bodies: [
      { id: "body-1", planetType: "toxic", scanTotal: 100, scanProgress: 0, hazard: 1, scanned: false, discoveries: [], activities: [], ...body },
    ],
    anomalyResolved: true,
    anomalyCharted: false,
    anomalyOptIn: false,
    findings: [],
    seed: 1,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: { security: [], science: [] },
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    roster: snapshotAwayRoster(state, state.ships[0]),
    encounterSteps: ENCOUNTER_STEPS,
    encounterEvasion: 0,
    scanStepCursor: 0,
    scanEvents: [],
    ...over,
  };
}

// The rate a neutral hand-built expedition scans at (SCAN_BASE_RATE 0.05, hazard 1 -> / 1.5).
const RATE_HAZARD_1 = 0.05 / 1.5;

// The first seed in [1, limit] whose expedition satisfies `pred`, else throws (the search is the test's
// precondition, so failing loudly beats a silently vacuous test).
function findSeed(make: (seed: number) => Expedition, pred: (e: Expedition) => boolean, limit = 2000): { seed: number; exp: Expedition } {
  for (let seed = 1; seed <= limit; seed++) {
    const exp = make(seed);
    if (pred(exp)) return { seed, exp };
  }
  throw new Error("no seed satisfied the precondition");
}

const BIG = 1_000_000;

// ============================================================================
describe("encounter chance formula", () => {
  it("base by hazard tier: 8% + hazard * 20%", () => {
    expect(encounterChance(0, 0, 0)).toBeCloseTo(ENCOUNTER_BASE_CHANCE);
    expect(encounterChance(1, 0, 0)).toBeCloseTo(ENCOUNTER_BASE_CHANCE + ENCOUNTER_HAZARD_CHANCE);
    expect(encounterChance(0.5, 0, 0)).toBeCloseTo(0.08 + 0.1);
  });

  it("the device dial scales the chance both ways, and Evasive Command cuts it", () => {
    const base = encounterChance(1, 0, 0);
    expect(encounterChance(1, -0.4, 0)).toBeCloseTo(base * 0.6); // a Shroud Emitter
    expect(encounterChance(1, 0.4, 0)).toBeCloseTo(base * 1.4); // a Lure Beacon
    expect(encounterChance(1, 0, 0.25)).toBeCloseTo(base * 0.75);
    expect(encounterChance(1, 0.4, 0.25)).toBeCloseTo(base * 1.4 * 0.75);
  });

  it("clamps to [0, 0.9] (and the evasion share to [0, 1])", () => {
    expect(encounterChance(1, 5, 0)).toBe(ENCOUNTER_CHANCE_MAX);
    expect(encounterChance(1, -1.2, 0)).toBe(0);
    expect(encounterChance(1, 0, 3)).toBe(0);
    expect(encounterChance(1, 0, -1)).toBeCloseTo(encounterChance(1, 0, 0));
  });

  it("reads the Security squad's worn Shroud / Lure from the roster snapshot", () => {
    const plain = withRoster(plainSquad());
    const shroud = withRoster(plainSquad(), [tool("equip-901", "shroudEmitter", "member-1")]);
    const lure = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    const twoLures = withRoster(
      [...plainSquad(), member("member-3", "security")],
      [tool("equip-901", "lureBeacon", "member-1"), tool("equip-902", "lureBeacon", "member-3")]
    );
    const bias = (s: GameState) => squadEncounterBias(snapshotAwayRoster(s, s.ships[0]).security, 1);
    expect(bias(plain)).toBe(0);
    expect(bias(shroud)).toBeCloseTo(-0.4);
    expect(bias(lure)).toBeCloseTo(0.4);
    expect(bias(twoLures)).toBeCloseTo(0.8);

    const body = scanExp(plain).bodies[0];
    const chance = (s: GameState) => scanEncounterChance(scanExp(s), body);
    expect(chance(shroud)).toBeLessThan(chance(plain));
    expect(chance(lure)).toBeGreaterThan(chance(plain));
    expect(chance(plain)).toBeCloseTo(ENCOUNTER_BASE_CHANCE + ENCOUNTER_HAZARD_CHANCE);
  });

  it("Evasive Command and the museum hazard resist both lower the run's chance", () => {
    const s = withRoster(plainSquad());
    const body = scanExp(s).bodies[0];
    const plain = scanEncounterChance(scanExp(s), body);
    expect(scanEncounterChance(scanExp(s, { encounterEvasion: 0.2 }), body)).toBeCloseTo(plain * 0.8);
    expect(scanEncounterChance(scanExp(s, { hazardResist: 0.5 }), body)).toBeLessThan(plain);
  });

  it("no Security member, no encounter chance (only a pre-D18 run can lack one)", () => {
    const s = withRoster([member("member-2", "science")]);
    const exp = scanExp(s);
    expect(scanEncounterChance(exp, exp.bodies[0])).toBe(0);
  });
});

// ============================================================================
describe("D20 field devices: the untrained multiplier is ONE tunable number, applied to every device", () => {
  it("the device bias is multiplied by the effectiveness it is given", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "shroudEmitter", "member-1")]);
    const security = snapshotAwayRoster(s, s.ships[0]).security;
    expect(squadEncounterBias(security, 0.75)).toBeCloseTo(-0.4 * 0.75);
    expect(squadEncounterBias(security, 0.5)).toBeCloseTo(-0.2);
  });

  it("the run's chance uses FIELD_DEVICE_UNTRAINED_EFFECTIVENESS (no specialist exists yet)", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    const exp = scanExp(s);
    expect(fieldDeviceEffectiveness(exp.roster)).toBe(FIELD_DEVICE_UNTRAINED_EFFECTIVENESS);
    expect(scanEncounterChance(exp, exp.bodies[0])).toBeCloseTo(
      encounterChance(1, 0.4 * FIELD_DEVICE_UNTRAINED_EFFECTIVENESS, 0)
    );
  });
});

// ============================================================================
describe("step boundaries roll exactly once each", () => {
  it("every interior boundary is rolled once, and an event is recorded exactly where the roll fired", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    for (let seed = 1; seed <= 40; seed++) {
      const start = scanExp(s, { seed });
      // Chunk the advance unevenly: 37-second steps, then a big finish.
      let e = start;
      for (let t = 37; t < 5000; t += 37) e = advanceExpedition(e, t);
      e = advanceExpedition(e, BIG);
      expect(e.scanStepCursor).toBe(ENCOUNTER_STEPS - 1);
      const keys = (e.scanEvents ?? []).map((ev) => `${ev.bodyIndex}:${ev.step}`);
      expect(new Set(keys).size).toBe(keys.length); // never two events at one boundary
      const expected: string[] = [];
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        const roll = scanStepRoll(start, 0, k);
        if (roll.encounter || roll.supplyCache) expected.push(`0:${k}`);
      }
      expect(keys).toEqual(expected);
      // Every finding is unique too (no double-award).
      const ids = e.findings.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("no roll happens at 0% or 100%: the cursor only counts interior boundaries", () => {
    const s = withRoster(plainSquad());
    const exp = scanExp(s);
    const bodyTime = 100 / RATE_HAZARD_1;
    // Just before the first boundary (10%): nothing rolled yet.
    const before = advanceExpedition(exp, bodyTime / ENCOUNTER_STEPS - 1);
    expect(before.scanStepCursor).toBe(0);
    expect(before.scanEvents).toEqual([]);
  });
});

// ============================================================================
describe("encounter outcomes", () => {
  it("a WIN adds the enemy drops as an encounter finding and the scan continues", () => {
    // A strong squad wins most fights; find a run whose first event is a won encounter.
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    const { exp } = findSeed(
      (seed) => advanceExpedition(scanExp(s, { seed, securityStrength: 60 }), BIG),
      (e) => (e.scanEvents ?? []).some((ev) => ev.kind === "encounter" && ev.outcome === "win")
    );
    const ev = exp.scanEvents!.find((x) => x.kind === "encounter" && x.outcome === "win")!;
    const finding = exp.findings.find((f) => f.id === ev.findingId)!;
    expect(finding.source).toBe("encounter");
    expect(finding.relic).toBeNull();
    expect(Object.values(finding.materials ?? {}).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(finding.credits).toBeGreaterThan(0);
    expect(ev.pauseSeconds).toBeUndefined();
    // The finding is exactly the keyed resolver's.
    const fresh = scanExp(s, { seed: exp.seed, securityStrength: 60 });
    expect(resolveScanEncounter(fresh, fresh.bodies[ev.bodyIndex], ev.bodyIndex, ev.step).finding).toEqual(finding);
    expect(exp.phase).not.toBe("scanning"); // the scan finished
  });

  it("a LOSS withdraws the team: no drops, findings so far stay, downed members recorded", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    const { exp } = findSeed(
      (seed) => advanceExpedition(scanExp(s, { seed }), BIG),
      (e) => (e.scanEvents ?? []).some((ev) => ev.kind === "encounter" && ev.outcome === "loss")
    );
    const ev = exp.scanEvents!.find((x) => x.kind === "encounter" && x.outcome === "loss")!;
    expect(ev.findingId).toBeUndefined();
    expect(ev.pauseSeconds).toBeGreaterThan(0);
    expect(ev.pauseSeconds).toBeLessThanOrEqual(ACTIVITY_SECONDS);
    // The lone Security member is down (a wipe), and named by member id.
    expect(ev.downedMemberIds).toEqual(["member-1"]);
    // Earlier finds are still on the expedition.
    const earlier = exp.scanEvents!.filter((x) => x.step < ev.step && x.findingId);
    for (const x of earlier) expect(exp.findings.some((f) => f.id === x.findingId)).toBe(true);
  });

  it("a loss PAUSES the body's scan until the next activity window, then the scan resumes", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    // A run whose FIRST event is a loss, so the boundary time has no earlier pause in it.
    const { seed, exp } = findSeed(
      (sd) => advanceExpedition(scanExp(s, { seed: sd }), BIG),
      (e) => e.scanEvents?.[0]?.kind === "encounter" && e.scanEvents[0].outcome === "loss"
    );
    const ev = exp.scanEvents![0];
    const bodyTime = 100 / RATE_HAZARD_1;
    const at = (ev.step * bodyTime) / ENCOUNTER_STEPS;
    expect(ev.pauseSeconds).toBeCloseTo(nextActivityWindow(at) - at, 6);

    const start = scanExp(s, { seed });
    const held = (t: number) => advanceExpedition(start, t).bodies[0].scanProgress;
    const atBoundary = (100 * ev.step) / ENCOUNTER_STEPS;
    // During the pause the progress holds at the boundary.
    expect(held(at + ev.pauseSeconds! * 0.25)).toBeCloseTo(atBoundary, 6);
    expect(held(at + ev.pauseSeconds! * 0.9)).toBeCloseTo(atBoundary, 6);
    // After the window the scan resumes from there.
    const resumed = held(at + ev.pauseSeconds! + 30);
    expect(resumed).toBeCloseTo(atBoundary + 30 * RATE_HAZARD_1, 6);
    // And the scanning phase lasted the body time plus every recorded pause.
    const pauses = exp.scanEvents!.reduce((sum, x) => sum + (x.pauseSeconds ?? 0), 0);
    const justBefore = advanceExpedition(start, bodyTime + pauses - 1);
    expect(justBefore.phase).toBe("scanning");
    const justAfter = advanceExpedition(start, bodyTime + pauses + 1);
    expect(justAfter.phase).toBe("activities");
  });

  it("the activity window grid is every ACTIVITY_SECONDS of scanning, strictly after the loss", () => {
    expect(nextActivityWindow(0)).toBe(ACTIVITY_SECONDS);
    expect(nextActivityWindow(599.5)).toBe(ACTIVITY_SECONDS);
    expect(nextActivityWindow(ACTIVITY_SECONDS)).toBe(2 * ACTIVITY_SECONDS);
    expect(nextActivityWindow(1234)).toBe(3 * ACTIVITY_SECONDS);
  });

  it("GroundBattleResult lists the named members down at the end (win or lose)", () => {
    const s = withRoster([member("member-1", "security"), member("member-3", "security"), member("member-2", "science")]);
    const roster = snapshotAwayRoster(s, s.ships[0]);
    let sawDowned = false;
    for (let seed = 1; seed <= 30; seed++) {
      const team = buildRosterCombatants(roster.security, 0, "t");
      const res = resolveGroundBattle(team, generateEncounter(seed, 1, "subterraneanCivilization"), 0, makeRng(seed));
      const downed = team.filter((c) => c.downed).map((c) => c.memberId);
      expect(res.downedMemberIds).toEqual(downed);
      if (res.result === "loss") expect(res.downedMemberIds.length).toBeGreaterThan(0);
      if (res.downedMemberIds.length > 0) sawDowned = true;
    }
    expect(sawDowned).toBe(true);
  });
});

// ============================================================================
describe("the supply-cache EVENT is the step roll's second draw", () => {
  it("never on a boundary that fired an encounter; fires on some boundaries without one", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    let caches = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const exp = scanExp(s, { seed });
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        const r = scanStepRoll(exp, 0, k);
        expect(r.encounter && r.supplyCache).toBe(false);
        if (r.supplyCache) caches++;
      }
    }
    expect(caches).toBeGreaterThan(0);
  });

  it("the second draw is independent of the first draw's odds (same stream, same position)", () => {
    // With no Security member the encounter chance is 0, yet the cache draw is the SAME draw.
    const sec = withRoster(plainSquad());
    const noSec = withRoster([member("member-2", "science")]);
    for (let seed = 1; seed <= 200; seed++) {
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        const a = scanStepRoll(scanExp(sec, { seed }), 0, k);
        const b = scanStepRoll(scanExp(noSec, { seed }), 0, k);
        expect(b.encounter).toBe(false);
        if (!a.encounter) expect(a.supplyCache).toBe(b.supplyCache);
      }
    }
  });

  it("a cache adds a small find recorded on the scan track", () => {
    const s = withRoster(plainSquad());
    const { exp } = findSeed(
      (seed) => advanceExpedition(scanExp(s, { seed }), BIG),
      (e) => (e.scanEvents ?? []).some((ev) => ev.kind === "supplyCache")
    );
    const ev = exp.scanEvents!.find((x) => x.kind === "supplyCache")!;
    const finding = exp.findings.find((f) => f.id === ev.findingId)!;
    expect(finding.source).toBe("supplyCache");
    expect(finding.relic).toBeNull();
    expect(finding).toEqual(rollSupplyCache(exp, exp.bodies[ev.bodyIndex], ev.bodyIndex, ev.step));
    expect(ev.outcome).toBeUndefined();
    expect(ev.pauseSeconds).toBeUndefined();
  });
});

// ============================================================================
describe("Evasive Command (the pilot officer's officer.evasion bonus)", () => {
  const pilot = (over: Partial<SeniorStaffOfficer> = {}): SeniorStaffOfficer => ({
    id: "officer-1",
    seat: "pilot",
    name: "Test Pilot",
    race: "earthBorn",
    gender: "nonbinary",
    rank: "ensign",
    bonuses: [
      { id: "pilot.evasion", magnitude: 0.15 },
      { id: "pilot.transitCut", magnitude: 0.08 },
    ],
    missionsCompleted: 0,
    assignedShipId: "ship-1",
    ...over,
  });

  it("officerBonusTotal sums the assigned officers' bonuses of that stat key", () => {
    const s = withRoster(plainSquad());
    expect(officerBonusTotal(s, s.ships[0], "officer.evasion")).toBe(0);
    const withPilot = { ...s, officers: [pilot()] };
    expect(officerBonusTotal(withPilot, s.ships[0], "officer.evasion")).toBeCloseTo(0.15);
    const elsewhere = { ...s, officers: [pilot({ assignedShipId: "ship-9" })] };
    expect(officerBonusTotal(elsewhere, s.ships[0], "officer.evasion")).toBe(0);
  });

  it("dispatch freezes it on the expedition with the step count", () => {
    const s = { ...withRoster(plainSquad()), officers: [pilot()] };
    const cand = expeditionCandidates(s, "ship-1")[0];
    const res = startExpedition(s, "ship-1", 1, cand.id);
    expect(res.success).toBe(true);
    expect(res.expedition!.encounterEvasion).toBeCloseTo(0.15);
    expect(res.expedition!.encounterSteps).toBe(ENCOUNTER_STEPS);
    expect(res.expedition!.scanStepCursor).toBe(0);
    expect(res.expedition!.scanEvents).toEqual([]);
  });
});

// ============================================================================
describe("PARITY: one big advance == many small advances, with a real roster", () => {
  it("is deep-equal, and the run includes an encounter and a loss pause", () => {
    // A real dispatched run (startExpedition: the roster snapshot, multi-body system, every phase).
    const base = withRoster(
      [member("member-1", "security"), member("member-3", "security"), member("member-2", "science")],
      [tool("equip-901", "lureBeacon", "member-1"), tool("equip-902", "lureBeacon", "member-3")]
    );
    let found: Expedition | null = null;
    for (let i = 0; i < 300 && !found; i++) {
      const s = { ...base, expeditionSeed: (0x1234567 + i * 7919) >>> 0 };
      const res = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
      if (!res.success) continue;
      const done = advanceExpedition(res.expedition!, BIG);
      const evs = done.scanEvents ?? [];
      if (evs.some((e) => e.kind === "encounter" && e.outcome === "loss") && evs.some((e) => e.outcome === "win") && done.bodies.length > 1) {
        found = res.expedition!;
      }
    }
    expect(found).not.toBeNull();
    const start = found!;
    const big = advanceExpedition(start, BIG);
    let small = start;
    for (let t = 0; t <= BIG; t += 97) small = advanceExpedition(small, t);
    small = advanceExpedition(small, BIG);
    expect(big.phase).toBe("complete");
    expect(small).toEqual(big);
  });
});

// ============================================================================
describe("NEUTRALITY: a run dispatched before Task 14 scans exactly as before", () => {
  it("no encounterSteps -> no rolls, no new fields, the scan ends at the plain body time", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    const legacy = scanExp(s, { encounterSteps: undefined, scanStepCursor: undefined, scanEvents: undefined });
    delete legacy.encounterSteps;
    delete legacy.scanStepCursor;
    delete legacy.scanEvents;
    delete legacy.encounterEvasion;
    const bodyTime = 100 / RATE_HAZARD_1;
    expect(advanceExpedition(legacy, bodyTime - 1).phase).toBe("scanning");
    const after = advanceExpedition(legacy, bodyTime + 1);
    expect(after.phase).toBe("activities");
    const done = advanceExpedition(legacy, BIG);
    expect(done.phase).toBe("complete");
    expect("scanEvents" in done).toBe(false);
    expect("scanStepCursor" in done).toBe(false);
    expect("encounterSteps" in done).toBe(false);
    expect(done.findings.every((f) => f.source === "activity" || f.source === "anomaly")).toBe(true);
  });
});

// ============================================================================
describe("review hardening", () => {
  it("ENCOUNTER_STEPS stays below 100 (scanStepKey is bodyIndex * 100 + step)", () => {
    expect(ENCOUNTER_STEPS).toBeLessThan(100);
  });

  it("deriveScanEncounterLog replays every recorded encounter's outcome, and is null where none happened", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const done = advanceExpedition(scanExp(s, { seed, securityStrength: seed % 2 === 0 ? 40 : 0 }), BIG);
      const evs = done.scanEvents ?? [];
      for (const ev of evs) {
        const log = deriveScanEncounterLog(done, ev.bodyIndex, ev.step);
        if (ev.kind === "encounter") {
          expect(log).not.toBeNull();
          expect(log!.outcome).toBe(ev.outcome);
          expect(log!.events.length).toBeGreaterThan(0);
          checked++;
        } else {
          expect(log).toBeNull(); // a supply cache is not a battle
        }
      }
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        if (!evs.some((ev) => ev.step === k)) expect(deriveScanEncounterLog(done, 0, k)).toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("officerBonusTotal applies the bridge module's officer amplification", () => {
    const s = withRoster(plainSquad());
    const bridge: EquipmentInstance = {
      id: "equip-bridge-mod",
      slotType: "bridge",
      rarity: "standard",
      ascension: "none",
      quality: 0,
      iLevel: 1,
      blueprintKey: null,
      implicitStats: {},
      rolledStats: {},
      mass: 0,
      powerDraw: 0,
      durabilityMax: 110,
      durability: 110,
      fittedToShipId: "ship-1",
      moduleVariant: "bridgeBalancedCommand",
    };
    const officer: SeniorStaffOfficer = {
      id: "officer-1",
      seat: "pilot",
      name: "Test Pilot",
      race: "earthBorn",
      gender: "nonbinary",
      rank: "ensign",
      bonuses: [
        { id: "pilot.evasion", magnitude: 0.15 },
        { id: "pilot.transitCut", magnitude: 0.08 },
      ],
      missionsCompleted: 0,
      assignedShipId: "ship-1",
    };
    const withBridge = { ...s, officers: [officer], equipment: [...s.equipment, bridge] };
    // Balanced Command: amp 0.1 at scale 1.0 (standard, quality 0), the same lift the crew overlay applies.
    expect(officerBonusTotal(withBridge, s.ships[0], "officer.evasion")).toBeCloseTo(0.15 * 1.1, 9);
  });
});

// ============================================================================
describe("the last body completes at the exact phase-end boundary (no rounding sliver)", () => {
  // Two bodies, no Security member (no encounter, so no pause): the scanning phase lasts t1 + t2.
  const bodies = (): ExpeditionBody[] => [
    { id: "body-1", planetType: "toxic", scanTotal: 100, scanProgress: 0, hazard: 1, scanned: false, discoveries: [], activities: [] },
    { id: "body-2", planetType: "terrestrial", scanTotal: 137, scanProgress: 0, hazard: 0.2, scanned: false, discoveries: [], activities: [] },
  ];
  const t = (b: ExpeditionBody) => b.scanTotal / (0.05 / (1 + b.hazard * 0.5));

  function check(exp: Expedition): void {
    const [b1, b2] = exp.bodies;
    const dur = 0 + t(b1) + t(b2);
    for (const now of [dur - 5e-7, dur, dur + 5e-7]) {
      const e = advanceExpedition(exp, now);
      expect(e.phase).toBe("activities");
      expect(e.bodies.every((b) => b.scanned && b.activities.length > 0)).toBe(true);
    }
    const before = advanceExpedition(exp, dur - 2e-6);
    expect(before.phase).toBe("scanning");
    expect(before.bodies[1].scanned).toBe(false);
  }

  it("encounter-enabled run", () => {
    const s = withRoster([member("member-2", "science")]);
    check(scanExp(s, { bodies: bodies() }));
  });

  it("legacy run (dispatched before Task 14)", () => {
    const s = withRoster([member("member-2", "science")]);
    const legacy = scanExp(s, { bodies: bodies() });
    delete legacy.encounterSteps;
    delete legacy.scanStepCursor;
    delete legacy.scanEvents;
    delete legacy.encounterEvasion;
    check(legacy);
  });
});
