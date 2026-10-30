// WR-5c (0.14.0): the captain secondary talents of the EXPLORER tree, wired. Each node acts on the ship its captain
// commands (OC-A2), as its own x (1 + X) factor (the 2026-10-17 "Always multiply" call), frozen at dispatch for a run,
// and reads its size from the catalog. The registry's sensitivity level measures each node's magnitude through its
// consumer (wiring/registry.ts explorerSecondaryEntries); these tests pin the rules around it: neutral without the
// node, own ship only, frozen at dispatch, offline == live, and the text.

import { describe, expect, it } from "vitest";
import { dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { SECONDARY_CAPTAIN_TALENTS, SENIOR_STAFF_ROSTER_BASE, type GameState, type SecondaryTalentKey, type ShipInstance } from "./model";
import {
  candidateBoardSize,
  captainComplementMult,
  captainOfficerOutputMult,
  captainPromotionMult,
  captainSensorsMult,
  captainSquadStrengthMult,
  captainSurveyScanParams,
  captainTelescopeSight,
  explorerCaptainRun,
  explorerNodeMagnitude,
  explorerTalentText,
} from "./captainExplorerEffects";
import { describeSecondaryTalentEffect, secondaryTalentEffectText } from "./captainSecondaryEffects";
import { effectiveShipStats, officerMissionOutputBonus } from "./crewOverlay";
import { discoveryOddsPermille, expeditionCandidates, rollBodyDiscoveries, scanRatePerSecond } from "./expedition";
import { dispatchCaptainOnMission, economyTick, tick } from "./tick";
import { officerPromotionCounter } from "./seniorStaff";
import { relicChancePermille, relicTierCeiling, rollRelicToken } from "./gambit";
import { readSystem, telescopeReading, TELESCOPE_DETAIL } from "./telescope";
import { expeditionRiskPreview } from "./expedition";
import { bucketOf, dispatchRun, editCaptain, installPiece, seatOfficer, syntheticBody, withAwayTeam, withBuckets, wiringBase } from "./wiring/probes";

const EXPLORER_KEYS = (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).filter((k) => SECONDARY_CAPTAIN_TALENTS[k].tree === "explorer");
const own = (s: GameState, ...keys: SecondaryTalentKey[]): GameState => editCaptain(s, { unlockedSecondaryTalents: keys });
const mag = (k: SecondaryTalentKey): number => explorerNodeMagnitude(k);
const ship1 = (s: GameState): ShipInstance => s.ships.find((x) => x.id === "ship-1")!;

// A second hull commanded by a second captain (captain 1 keeps ship-1).
function withSecondShip(s: GameState): GameState {
  const second: ShipInstance = { ...ship1(s), id: "ship-2", assignedCaptainId: 2 };
  return { ...s, ships: [...s.ships, second], captains: [...s.captains, { ...s.captains[0], id: 2, mission: null, unlockedSecondaryTalents: [] }] };
}

describe("WR-5c readers: exactly neutral without the node", () => {
  it("every reader returns its neutral value for a captain with no explorer node (and for no captain)", () => {
    for (const c of [undefined, wiringBase().captains[0]]) {
      expect(captainSensorsMult(c)).toBe(1);
      expect(captainSurveyScanParams(c)).toEqual({});
      expect(captainTelescopeSight(c)).toEqual({ lift: 0, full: false });
      expect(captainSquadStrengthMult(c)).toBe(1);
      expect(explorerCaptainRun(c)).toBeUndefined();
      expect(captainComplementMult(c)).toBe(1);
      expect(captainOfficerOutputMult(c)).toBe(1);
      expect(captainPromotionMult(c)).toBe(1);
    }
    expect(candidateBoardSize(wiringBase())).toBe(SENIOR_STAFF_ROSTER_BASE);
  });

  it("each node is its own x (1 + X) factor, read from the catalog (Legendary Captain compounds with Inspiring Leader and Mentor)", () => {
    const c = own(wiringBase(), "commandCrew1", "commandCrew2", "commandCrew5").captains[0];
    expect(captainComplementMult(c)).toBeCloseTo((1 + mag("commandCrew1")) * (1 + mag("commandCrew5")), 12);
    expect(captainOfficerOutputMult(c)).toBeCloseTo((1 + mag("commandCrew2")) * (1 + mag("commandCrew5")), 12);
    expect(captainSensorsMult(own(wiringBase(), "surveySensors1").captains[0])).toBe(1 + mag("surveySensors1"));
  });

  it("OC-A3: no explorer node is a placeholder (every one has a nonzero configured size)", () => {
    for (const k of EXPLORER_KEYS) expect(mag(k), k).toBeGreaterThan(0);
  });
});

describe("WR-5c own ship (OC-A2): a node acts only on the ship its captain commands", () => {
  it("Keen Sensors on captain 1 lifts ship-1's sensors and leaves ship-2's alone", () => {
    const base = withSecondShip(installPiece(wiringBase(), { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } }));
    const withNode = own(base, "surveySensors1");
    const s2 = (s: GameState) => s.ships.find((x) => x.id === "ship-2")!;
    expect(effectiveShipStats(withNode, ship1(withNode)).sensors).toBeCloseTo(effectiveShipStats(base, ship1(base)).sensors * (1 + mag("surveySensors1")), 9);
    expect(effectiveShipStats(withNode, s2(withNode))).toEqual(effectiveShipStats(base, s2(base)));
  });

  it("Mentor scales only the officers of the captain's own ship", () => {
    const base = withSecondShip(seatOfficer(wiringBase(), "executive", ["xo.commandOutput"]));
    // The same officer seated on ship-2 (captain 2, no node).
    const officer2 = { ...base.officers[0], id: "officer-2", assignedShipId: "ship-2" };
    const both = { ...base, officers: [...base.officers, officer2] };
    const withNode = own(both, "commandCrew2");
    const s2 = withNode.ships.find((x) => x.id === "ship-2")!;
    expect(officerMissionOutputBonus(withNode, ship1(withNode))).toBeCloseTo(officerMissionOutputBonus(both, ship1(both)) * (1 + mag("commandCrew2")), 12);
    expect(officerMissionOutputBonus(withNode, s2)).toBe(officerMissionOutputBonus(both, s2));
  });
});

describe("WR-5c Survey & Sensors", () => {
  it("Cartographer and Anomaly Sense ride the frozen scan params; a run dispatched without them keeps the four-field record", () => {
    const plain = dispatchRun(wiringBase());
    expect(Object.keys(plain.scanParams).sort()).toEqual(["coverageWidth", "landmarkOddsBias", "scanRateMult", "undergroundPoiOddsBias"]);
    const run = dispatchRun(own(wiringBase(), "surveySensors2", "surveySensors3"));
    expect(run.scanParams.captainScanRateMult).toBe(1 + mag("surveySensors2"));
    expect(run.scanParams.captainDiscoveryMult).toBe(1 + mag("surveySensors3"));
    const body = syntheticBody("terrestrial", 0);
    expect(scanRatePerSecond(run, body)).toBeCloseTo(scanRatePerSecond(plain, body) * (1 + mag("surveySensors2")), 12);
    expect(discoveryOddsPermille(run.scanParams, "terrestrial").surface).toBe(Math.round(discoveryOddsPermille(plain.scanParams, "terrestrial").surface * (1 + mag("surveySensors3"))));
  });

  it("frozen at dispatch: a node learned after the dispatch never reaches the run in flight (the run reads its record)", () => {
    const s0 = withAwayTeam(wiringBase());
    const res = dispatchPastPropulsion(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id);
    expect(res.success).toBe(true);
    const later = own(res.next, "surveySensors2");
    expect(later.expeditions[0]).toEqual(res.next.expeditions[0]);
    expect(later.expeditions[0].scanParams.captainScanRateMult).toBeUndefined();
  });

  it("Deep Scan: each body's first attempts are sure finds (odds forced to 0 to show it), and the draw count per attempt is kept", () => {
    const run = dispatchRun(wiringBase());
    const zero = { ...run, scanParams: { ...run.scanParams, landmarkOddsBias: -1, undergroundPoiOddsBias: -1 } };
    const body = syntheticBody("terrestrial", 0);
    // With no odds, the guaranteed fallback leaves exactly one find.
    expect(rollBodyDiscoveries(zero, body, 0).length).toBe(1);
    const sure = { ...zero, scanParams: { ...zero.scanParams, captainSureFinds: 3 } };
    expect(rollBodyDiscoveries(sure, body, 0).length).toBe(3);
    // The catalog size reaches the scan params.
    expect(captainSurveyScanParams(own(wiringBase(), "surveySensors5").captains[0]).captainSureFinds).toBe(mag("surveySensors5"));
  });

  it("Foreknowledge lifts each candidate one detail level; Deep Scan reads every candidate in full, foreknowledge included", () => {
    const base = wiringBase();
    const plain = expeditionCandidates(base, "ship-1");
    const fore = expeditionCandidates(own(base, "surveySensors4"), "ship-1");
    const deep = expeditionCandidates(own(base, "surveySensors5"), "ship-1");
    expect(plain.filter((c) => !c.telescope.blind).length).toBeGreaterThan(0); // vacuity guard
    plain.forEach((c, i) => {
      if (c.telescope.blind) return;
      expect(fore[i].telescope.detail).toBe(Math.min(TELESCOPE_DETAIL.forecast, c.telescope.detail + mag("surveySensors4")));
      expect(fore[i].telescope.captainSight).toBe("foreknowledge");
      expect(deep[i].telescope.detail).toBe(TELESCOPE_DETAIL.forecast);
      expect(deep[i].telescope.captainSight).toBe("deepScan");
      expect(deep[i].foreknowledge.inRange).toBe(true);
      expect(deep[i].foreknowledge.relicSets).not.toBeNull();
      expect(deep[i].foreknowledge.bodies?.every((b) => b.planetType !== null && b.hazard !== null)).toBe(true);
      // The run itself is the same draw: the seeds do not move.
      expect(deep[i].seed).toBe(c.seed);
    });
    expect(plain.some((c) => c.telescope.captainSight !== undefined)).toBe(false);
  });

  it("a captain's sight never reaches beyond the telescope's range (a blind system stays blind)", () => {
    const reading = telescopeReading(wiringBase());
    const seed = 12345;
    const preview = expeditionRiskPreview(seed);
    const blindReading = { ...reading, reachTier: 0 as const, rangeLy: 0 };
    const r = readSystem(blindReading, seed, 100, preview, undefined, { lift: 3, full: true });
    expect(r.blind).toBe(true);
    expect(r.detail).toBe(0);
    expect(r.captainSight).toBeUndefined();
  });
});

describe("WR-5c Expedition & Relics", () => {
  it("Expedition Lead multiplies both frozen squad strengths", () => {
    const base = withBuckets(wiringBase(), [bucketOf("security", "sec.boarding"), bucketOf("science", "sci.rareFind")]);
    const plain = dispatchRun(base);
    const led = dispatchRun(own(base, "expeditionRelics1"));
    expect(plain.securityStrength).toBeGreaterThan(0);
    expect(led.securityStrength).toBeCloseTo(plain.securityStrength * (1 + mag("expeditionRelics1")), 12);
    expect(led.scienceStrength).toBeCloseTo(plain.scienceStrength * (1 + mag("expeditionRelics1")), 12);
  });

  it("the run freezes Field Science, Doctrine, Preservationist, Relic Hunter and Drillmaster on explorerCaptain, only when owned", () => {
    expect(dispatchRun(wiringBase()).explorerCaptain).toBeUndefined();
    const run = dispatchRun(own(wiringBase(), "expeditionRelics2", "expeditionRelics3", "expeditionRelics4", "expeditionRelics5", "commandCrew3"));
    expect(run.explorerCaptain).toEqual({
      relicFindMult: 1 + mag("expeditionRelics2"),
      squadPowerMult: 1 + mag("expeditionRelics3"),
      relicStudySpeed: mag("expeditionRelics4"),
      relicTierLift: mag("expeditionRelics5"),
      promotionMult: 1 + mag("commandCrew3"),
    });
  });

  it("the relic roll: absent captain fields are the pre-WR-5c roll; Field Science is its own factor; Relic Hunter lifts the ceiling, never past the top", () => {
    for (const h of [0, 0.3, 0.7, 1]) {
      for (const fb of [0, 0.12]) expect(relicChancePermille(h, fb)).toBe(relicChancePermille(h, fb, undefined));
    }
    expect(relicChancePermille(0.5, 0.12, 1.05)).toBe(Math.min(1000, Math.round((350 + 200) * 1.12 * 1.05)));
    expect(relicTierCeiling(0, 1)).toBe(relicTierCeiling(0) + 1);
    expect(relicTierCeiling(1, 5)).toBe(relicTierCeiling(1));
    // The token carries the study speed only under Preservationist; the draws are the same either way.
    let seed = 1;
    while (!rollRelicToken(seed, 1, "buriedVault", "r")) seed++;
    const plain = rollRelicToken(seed, 1, "buriedVault", "r")!;
    const kept = rollRelicToken(seed, 1, "buriedVault", "r", 0, { relicStudySpeed: 0.08 })!;
    expect(plain.studySpeed).toBeUndefined();
    expect(kept).toEqual({ ...plain, studySpeed: 0.08 });
  });
});

describe("WR-5c Command & Crew", () => {
  // User 2026-10-19 ("Best one counts"): the fleet-wide boards use the best Recruiter owned by any captain; owning it
  // twice adds nothing (replaces the built compounding, which made two Recruiters 10 x 1.08 x 1.08 -> 12).
  it("Recruiter: 10 x 1.08 rounds up to 11 on both boards; a second Recruiter captain adds nothing (best one counts)", () => {
    const one = own(wiringBase(), "commandCrew4");
    expect(candidateBoardSize(one)).toBe(Math.ceil(SENIOR_STAFF_ROSTER_BASE * (1 + mag("commandCrew4"))));
    const two = { ...one, captains: [...one.captains, { ...one.captains[0], id: 2 }] };
    expect(candidateBoardSize(two)).toBe(candidateBoardSize(one));
    // A Recruiter on a second captain only (the first owns none) still counts.
    const other = { ...wiringBase(), captains: [...wiringBase().captains, { ...one.captains[0], id: 2 }] };
    expect(candidateBoardSize(other)).toBe(candidateBoardSize(one));
  });

  it("Drillmaster: offline == live (one tick() call, 997 s chunks and 1 s ticks give the same officer counters)", () => {
    const s0 = own(seatOfficer(wiringBase(), "science", ["sci.discovery"]), "commandCrew3");
    const r = dispatchCaptainOnMission(s0, 1, "shortOreRun");
    expect(r.success).toBe(true);
    const rng = () => 0.5;
    const once = tick(1994, r.next, rng);
    const chunks = tick(997, tick(997, r.next, rng), rng);
    let ones = r.next;
    for (let i = 0; i < 1994; i++) ones = tick(1, ones, rng);
    expect(chunks.officers).toEqual(once.officers);
    expect(ones.officers).toEqual(once.officers);
    // And it is the plain counter x 1.08.
    const plain = tick(1994, dispatchCaptainOnMission(seatOfficer(wiringBase(), "science", ["sci.discovery"]), 1, "shortOreRun").next, rng);
    const hours = (s: GameState) => officerPromotionCounter(s.officers[0], "crewHours");
    expect(hours(once)).toBeCloseTo(hours(plain) * (1 + mag("commandCrew3")), 9);
    expect(once.officers[0].missionsCompleted).toBeCloseTo(plain.officers[0].missionsCompleted * (1 + mag("commandCrew3")), 9);
    // economyTick reads the incoming state's captain: a single call agrees too.
    // In whole milliseconds (the crewHours determinism fix): 1 s x 1.08 = 1080 ms, exactly.
    expect(economyTick(r.next, 1, rng).officers[0].crewHoursMs).toBe(Math.round(1000 * (1 + mag("commandCrew3"))));
  });
});

describe("WR-5c text: every explorer node says exactly what it does (no placeholder, no first-pass)", () => {
  it("each explorer node has its own text from the catalog, and the describer serves it", () => {
    for (const k of EXPLORER_KEYS) {
      const text = explorerTalentText(k);
      expect(text, k).not.toBeNull();
      expect(text).not.toMatch(new RegExp(`No bonus yet|first-pass|-{2}|${String.fromCharCode(0x2014)}`));
      expect(secondaryTalentEffectText(k)).toBe(text);
      expect(describeSecondaryTalentEffect(SECONDARY_CAPTAIN_TALENTS[k].effect)).toBe(text);
    }
    expect(explorerTalentText("surveySensors1")).toBe("+5% ship sensors (surveys, expedition scans and the telescope's ship lift)");
    expect(explorerTalentText("commandCrew4")).toBe(
      "+8% candidate board size, rounded up (+1 on each board of 10); fleet-wide, the best Recruiter counts and a second one adds nothing",
    );
    expect(explorerTalentText("extraction1")).toBeNull();
  });
});
