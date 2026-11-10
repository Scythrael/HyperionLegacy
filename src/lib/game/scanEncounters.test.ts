// E-CREW 0.14.0 (Task 14): RANDOM ENCOUNTERS during scan progress (design D10).
//
// Covers:
//   - the chance formula: base by hazard, the Shroud / Lure dial, Evasive Command, the clamp (the ship-event
//     chance reads the same formula, expedition.ts shipScanEventChance);
//   - D20: the field-device multiplier is applied to every device bias (one tunable number);
//   - the supply-cache event is the step roll's second draw and only counts when draw 1 fired nothing;
//   - Evasive Command is snapshotted at dispatch from the pilot officer.
//
// Wiring OC-G1 (user 2026-10-16 "Delete it"): the legacy (pre-Ground-Ops) scan battles are deleted, so every test here
// that drove a LEGACY run's scan (scanEncounterChance, the battles' outcomes, their loss pauses and the activity window
// grid, the cache found by a legacy advance, the legacy parity and neutrality runs, deriveScanEncounterLog, the legacy
// phase-end sliver) is RETIRED with it: each proved only the legacy path. What stays proves live rules: the chance
// formula (encounterChance, the ship-event chance's formula), the device dial, the step roll's two draws, the battle
// result's downed list, Evasive Command's dispatch freeze and the officer amplification. A Ground Ops run's scan walk,
// its ship events and caches, and its parity are proven in groundOps*.test.ts and shipScanEvents.test.ts.

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
  encounterChance,
  expeditionCandidates,
  scanStepRoll,
  squadEncounterBias,
  ENCOUNTER_BASE_CHANCE,
  ENCOUNTER_CHANCE_MAX,
  ENCOUNTER_HAZARD_CHANCE,
  ENCOUNTER_STEPS,
} from "./expedition";
import { snapshotAwayRoster } from "./awayTeam";
import { officerBonusTotal } from "./crewOverlay";
import { resolveGroundBattle, buildRosterCombatants, generateEncounter } from "./gambit";
import { makeRng } from "./combat/rng";
import { withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";

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
    fittedToShipId: null,
    fittedToMemberId: wearer,
  };
}

function withRoster(members: AwayMember[], gear: EquipmentInstance[] = []): GameState {
  const base = freshState();
  // Ground Ops (GO-7b): dispatch reads the slotted ground teams; slot the members in hire order.
  return withSlottedAwayTeams({ ...base, awayMembers: members, equipment: [...base.equipment, ...gear], nextAwayMemberId: 100 });
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
  });

});

// ============================================================================
describe("D20 field devices: the dial at the effectiveness it is given", () => {
  it("the device bias is multiplied by the effectiveness it is given", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "shroudEmitter", "member-1")]);
    const security = snapshotAwayRoster(s, s.ships[0]).security;
    expect(squadEncounterBias(security, 0.75)).toBeCloseTo(-0.4 * 0.75);
    expect(squadEncounterBias(security, 0.5)).toBeCloseTo(-0.2);
  });

});

// ============================================================================
describe("ground battle results", () => {
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
// Wiring OC-G1: draw 1 is a SHIP EVENT on a run with ship events (shipScanEvents.ts shipEventsLive reads the frozen
// profile's battle inputs; a stub marks the run live here) and chance 0 on one without (a run dispatched before GO-8).
const withShipEvents = (e: Expedition): Expedition => ({ ...e, groundOps: { shipEventProfile: { battle: {} } } as unknown as Expedition["groundOps"] });

describe("the supply-cache EVENT is the step roll's second draw", () => {
  it("never on a boundary that fired a ship event; fires on some boundaries without one", () => {
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    let caches = 0;
    let events = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const exp = withShipEvents(scanExp(s, { seed }));
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        const r = scanStepRoll(exp, 0, k);
        expect(r.encounter && r.supplyCache).toBe(false);
        if (r.supplyCache) caches++;
        if (r.encounter) events++;
      }
    }
    expect(caches).toBeGreaterThan(0);
    expect(events).toBeGreaterThan(0);
  });

  it("the second draw is independent of the first draw's odds (same stream, same position)", () => {
    // A run without ship events rolls draw 1 at chance 0, yet the cache draw is the SAME draw.
    const s = withRoster(plainSquad(), [tool("equip-901", "lureBeacon", "member-1")]);
    let compared = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (let k = 1; k < ENCOUNTER_STEPS; k++) {
        const a = scanStepRoll(withShipEvents(scanExp(s, { seed })), 0, k);
        const b = scanStepRoll(scanExp(s, { seed }), 0, k);
        expect(b.encounter).toBe(false);
        if (!a.encounter) {
          expect(a.supplyCache).toBe(b.supplyCache);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
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
    const res = dispatchPastPropulsion(s, "ship-1", 1, cand.id);
    expect(res.success).toBe(true);
    expect(res.expedition!.encounterEvasion).toBeCloseTo(0.15);
    expect(res.expedition!.encounterSteps).toBe(ENCOUNTER_STEPS);
    expect(res.expedition!.scanStepCursor).toBe(0);
    expect(res.expedition!.scanEvents).toEqual([]);
  });
});

// ============================================================================
describe("review hardening", () => {
  it("ENCOUNTER_STEPS stays below 100 (scanStepKey is bodyIndex * 100 + step)", () => {
    expect(ENCOUNTER_STEPS).toBeLessThan(100);
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
