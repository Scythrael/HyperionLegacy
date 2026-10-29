// WR-7 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-7): the ship systems
// (non-combat), each against the user's answer (USER ANSWERS 2026-10-15).

import { describe, expect, it } from "vitest";
import { EQUIPMENT_SLOTS, SHIP_TYPES, VARIETY_RESIST_RATIO, type GameState, type ShipTypeKey } from "./model";
import { rollDistinctAffixStats, varietyStatBias } from "./itemgen";
import { makeRng } from "./combat/rng";
import { advanceExpedition, bodyDiscoveryAttempts, candidateReach, candidateSystemById, coverageAttempts, scanRatePerSecond } from "./expedition";
import { SENSOR_ARRAYS } from "./sensorArrays";
import { arrayCharacterLine } from "../expeditionDispatchDisplay";
import { fieldRepairSeconds } from "./groundOps";
import { damageControlEffect } from "./utilityGear";
import { equippedFor } from "./equipmentQueries";
import { CREW_MODULE_LINE_KNEE, crewModuleLineScale, crewStationsBerths, installedQuartersModule, quartersCapacityBonus, quartersProfessionMultiplier } from "./crewModules";
import { CREW_PROFESSIONS, commandStructureForHull, commandStructureWithBonus, complementTotalCap, divisionCap, inclusiveRankCap } from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";
import { dispatchCaptainOnMission } from "./tick";
import { missionRunSheet } from "./gearWearEngine";
import type { CaptainMissionState } from "./model";
import { diminishing } from "./diminishing";
import { PLATING_RESIST_LINES, EMITTER_RESIST_LINES } from "./combat/combatRules";
import { dispatchRun, installPiece, seatOfficer, wiringBase } from "./wiring/probes";

const SHIP = "ship-1";
const shipOf = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;
const arrayDef = (id: string) => SENSOR_ARRAYS.find((a) => a.id === id)!;
const withArray = (s: GameState, id: string) => installPiece(s, { slotType: "sensor", moduleVariant: id });

describe("OC-D11: sensor array cadence and coverage act apart (user \"Split the two\"; B12)", () => {
  it("coverageAttempts scales the rolled count by the width, rounded, at least one", () => {
    expect(coverageAttempts(3, 1.5)).toBe(5);
    expect(coverageAttempts(4, 1.5)).toBe(6);
    expect(coverageAttempts(3, 0.6)).toBe(2);
    expect(coverageAttempts(4, 1)).toBe(4);
    expect(coverageAttempts(1, 0.1)).toBe(1);
  });

  it("a new Focused run scans at its cadence alone (faster than Balanced), a Wide run rolls more finds per body", () => {
    const base = wiringBase("orion");
    const balanced = dispatchRun(withArray(base, "sensorBalanced"));
    const focused = dispatchRun(withArray(base, "sensorFocusedBeam"));
    const wide = dispatchRun(withArray(base, "sensorWideBeam"));
    expect(balanced.arraySplit).toBeUndefined(); // coverage 1: the record is unchanged
    expect(focused.arraySplit).toBe(true);
    const body = focused.bodies[0];
    const ratio = scanRatePerSecond(focused, body) / scanRatePerSecond(balanced, body);
    expect(ratio).toBeCloseTo(arrayDef("sensorFocusedBeam").scanRateMult / arrayDef("sensorBalanced").scanRateMult, 9);
    expect(ratio).toBeGreaterThan(1);
    for (let i = 0; i < wide.bodies.length; i++) {
      const rolled = bodyDiscoveryAttempts({ ...wide, arraySplit: undefined }, i);
      expect(bodyDiscoveryAttempts(wide, i)).toBe(coverageAttempts(rolled, arrayDef("sensorWideBeam").coverageWidth));
    }
  });

  it("a run dispatched before WR-7 (no stamp) keeps the product rate and the rolled attempts", () => {
    const focused = dispatchRun(withArray(wiringBase("orion"), "sensorFocusedBeam"));
    const legacy = { ...focused, arraySplit: undefined };
    const body = focused.bodies[0];
    expect(scanRatePerSecond(legacy, body) / scanRatePerSecond(focused, body)).toBeCloseTo(arrayDef("sensorFocusedBeam").coverageWidth, 9);
    const done = advanceExpedition(structuredClone(legacy), legacy.phaseAnchorSeconds + 30 * 86400);
    expect(done.bodies.length).toBe(legacy.bodies.length);
  });

  it("every array kind has a character line, and each clause is true of its numbers", () => {
    const by = (kind: string) => SENSOR_ARRAYS.find((a) => a.kind === kind)!;
    for (const a of SENSOR_ARRAYS) expect(arrayCharacterLine(a.kind).length).toBeGreaterThan(20);
    expect(by("wide").scanRateMult).toBeLessThan(1); // slower scans
    expect(by("wide").coverageWidth).toBeGreaterThan(1); // more finds per body
    expect(by("wide").landmarkOddsBias).toBeGreaterThan(by("wide").undergroundPoiOddsBias); // surface-landmark odds
    expect(by("focused").scanRateMult).toBeGreaterThan(1); // faster scans
    expect(by("focused").coverageWidth).toBeLessThan(1); // fewer finds per body
    expect(by("focused").undergroundPoiOddsBias).toBeGreaterThan(0);
    expect(by("balanced").scanRateMult).toBe(1);
    expect(by("balanced").coverageWidth).toBe(1);
    expect(by("bioResonance").scanRateMult).toBe(Math.min(...SENSOR_ARRAYS.map((a) => a.scanRateMult))); // the slowest
    expect(by("bioResonance").relicFindBonus).toBeGreaterThan(0);
    expect(by("resonance").scanRateMult).toBe(1);
    expect(by("resonance").coverageWidth).toBe(1);
    expect(by("resonance").canisterBandLift).toBeGreaterThan(0);
  });
});

describe("OC-D6: unlisted = never rolls (B11)", () => {
  it("a variety with ratios biases only what it lists; an empty ratios is neutral", () => {
    expect(varietyStatBias({ cargoCapacity: 0.9 }, "massReduction")).toBe(0);
    expect(varietyStatBias({ cargoCapacity: 0.9 }, "cargoCapacity")).toBe(0.9);
    expect(varietyStatBias({}, "anything")).toBe(1);
    expect(varietyStatBias(undefined, "anything")).toBe(1);
  });

  it("every ship variety rolls only listed stats (Hauler Hold: no mass relief), and the resist lines still roll", () => {
    for (const [slotType, slot] of Object.entries(EQUIPMENT_SLOTS)) {
      for (const v of slot.varieties) {
        const listed = Object.keys(v.statRatios);
        if (listed.length === 0) continue;
        const rng = makeRng(0x7b23);
        for (let i = 0; i < 200; i++) {
          for (const stat of rollDistinctAffixStats(v.affixPool ?? slot.affixPool, v, 3, () => rng.next())) expect(listed, `${slotType}/${v.key}`).toContain(stat);
        }
      }
    }
    for (const [slotType, lines] of [["hullPlating", PLATING_RESIST_LINES], ["shieldEmitters", EMITTER_RESIST_LINES]] as const) {
      for (const v of EQUIPMENT_SLOTS[slotType].varieties) for (const k of lines) expect(v.statRatios[k], `${v.key} ${k}`).toBe(VARIETY_RESIST_RATIO);
    }
  });
});

describe("OC-D10: the Damage Control Suite shortens field repairs (user \"Field repairs too\")", () => {
  it("a run with the suite freezes its reduction; the field repair is shortened exactly as the Shipyard's", () => {
    const s = installPiece(wiringBase("orion"), { slotType: "specUtility", moduleVariant: "damageControlSuite", implicitStats: { repairSpeed: 20 } });
    const reduction = damageControlEffect(equippedFor(s, SHIP)).repairTimeReduction;
    const battle = dispatchRun(s).groundOps?.shipEventProfile.battle;
    expect(battle?.dcRepairTimeReduction).toBeCloseTo(reduction, 12);
    expect(fieldRepairSeconds(400, 0, true, reduction)).toBeLessThan(fieldRepairSeconds(400, 0, true));
    expect(fieldRepairSeconds(400, 0, true, 0)).toBe(fieldRepairSeconds(400, 0, true));
    // Without the suite nothing is written (a run without it keeps its record).
    expect(dispatchRun(wiringBase("orion")).groundOps?.shipEventProfile.battle).not.toHaveProperty("dcRepairTimeReduction");
  });
});

describe("OC-D3 + OC-D7: crew module lines and quarters capacity", () => {
  it("installing quarters never removes a seat: every rank cap with a bonus of 1 to 200 is at least the hull's own (review fix)", () => {
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      for (const p of CREW_PROFESSIONS) {
        const base = CREW_RANK_ORDER.map((r) => inclusiveRankCap(hull, p, r));
        for (let bonus = 1; bonus <= 200; bonus++) {
          const s = commandStructureWithBonus(hull, bonus).divisions[p];
          expect(CREW_RANK_ORDER.reduce((n, r) => n + s.rankAllocations[r], 0), `${hull} ${p} +${bonus} sums to its cap`).toBe(s.cap);
          CREW_RANK_ORDER.forEach((r, i) => expect(inclusiveRankCap(hull, p, r, bonus), `${hull} ${p} rank ${r} +${bonus}`).toBeGreaterThanOrEqual(base[i]));
        }
      }
    }
  });

  it("a captain mission reads the module lines only when stamped at dispatch; a run in flight from before keeps the old reading", () => {
    const s0 = installPiece(seatOfficer(wiringBase(), "operations", ["ops.cargoExpand"]), { slotType: "bridge", moduleVariant: "bridgeBalancedCommand", implicitStats: { crewEfficiency: 40 } });
    const s = { ...s0, captains: s0.captains.map((c) => ({ ...c, level: 10 })) };
    const r = dispatchCaptainOnMission(s, 1, "shortOreRun");
    const m = r.next.captains[0].mission as CaptainMissionState;
    expect(m.moduleLines).toBe(1);
    const ship = r.next.ships[0];
    const { moduleLines: _drop, ...legacy } = m;
    const stripped = { ...r.next, equipment: r.next.equipment.map((e) => (e.slotType === "bridge" ? { ...e, implicitStats: {} } : e)) };
    expect(missionRunSheet(r.next, ship, legacy as CaptainMissionState)).toEqual(missionRunSheet(stripped, ship, m));
    expect(missionRunSheet(r.next, ship, m).cargoCapacity).toBeGreaterThan(missionRunSheet(r.next, ship, legacy as CaptainMissionState).cargoCapacity);
    // Without a lined module nothing is stamped (the record is unchanged).
    const plain = { ...wiringBase(), captains: wiringBase().captains.map((c) => ({ ...c, level: 10 })) };
    expect((dispatchCaptainOnMission(plain, 1, "shortOreRun").next.captains[0].mission as CaptainMissionState).moduleLines).toBeUndefined();
  });

  const quarters = (hull: ShipTypeKey, variant: string, lines: Record<string, number> = {}) =>
    installPiece(wiringBase(hull), { slotType: "quarters", moduleVariant: variant, rolledStats: lines });

  it("Crew Stations and Crew Efficiency scale the module on the D23 curve; Crew Stations also adds berths", () => {
    const bare = quarters("destroyer", "quartersUtilitarian");
    const lined = quarters("destroyer", "quartersUtilitarian", { crewStations: 12, crewEfficiency: 8 });
    const piece = installedQuartersModule(lined, shipOf(lined))!.instance;
    expect(crewModuleLineScale(piece)).toBeCloseTo(1 + diminishing(20, CREW_MODULE_LINE_KNEE) / CREW_MODULE_LINE_KNEE, 12);
    expect(crewStationsBerths(piece)).toBe(12);
    expect(quartersCapacityBonus(lined, shipOf(lined)) - quartersCapacityBonus(bare, shipOf(bare))).toBe(12);
    const m0 = quartersProfessionMultiplier(installedQuartersModule(bare, shipOf(bare))!, "operations") - 1;
    const m1 = quartersProfessionMultiplier(installedQuartersModule(lined, shipOf(lined))!, "operations") - 1;
    expect(m1 / m0).toBeCloseTo(crewModuleLineScale(piece), 12);
  });

  it("the quarters bonus spreads across the division caps (B22): an empty complement can fill about that many more", () => {
    for (const hull of ["generalFreighter", "destroyer", "eir"] as ShipTypeKey[]) {
      expect(commandStructureWithBonus(hull, 0)).toBe(commandStructureForHull(hull)); // no module: the same template
      const bonus = 40;
      const before = CREW_PROFESSIONS.reduce((n, p) => n + divisionCap(hull, p), 0);
      const after = CREW_PROFESSIONS.reduce((n, p) => n + divisionCap(hull, p, bonus), 0);
      expect(after - before).toBeGreaterThanOrEqual(bonus - CREW_PROFESSIONS.length / 2);
      expect(complementTotalCap(hull, bonus)).toBe(complementTotalCap(hull) + bonus);
    }
  });
});

describe("OC-D8: fuel and engine efficiency reach the expedition reach gate (G2-4)", () => {
  it("a bigger tank reaches further on the same candidate", () => {
    const s = wiringBase("orion");
    const cand = candidateSystemById(s, "cand-1-0")!;
    const more = installPiece(s, { slotType: "ftlDrive", implicitStats: { fuelCapacity: 50 } });
    expect(candidateReach(more, shipOf(more), cand).reachLy).toBeGreaterThan(candidateReach(s, shipOf(s), cand).reachLy);
  });
});

describe("OC-D13: hull descriptions are true of the built hulls (the explorers and the battleship: trainingRunDisplay.test.ts)", () => {
  const H = SHIP_TYPES;
  const tacticians = Object.values(H).filter((d) => d.spec === "tactician");
  it("the economy hulls", () => {
    expect(H.prospectorHauler.description).toBe("Doubles cargo at the cost of speed, big hauls, longer runs.");
    expect(H.prospectorHauler.cargoCapacity).toBe(2 * H.generalFreighter.cargoCapacity);
    expect(H.prospectorHauler.transitSpeedMult).toBeLessThan(H.generalFreighter.transitSpeedMult);
    expect(H.prospectorRunner.description).toBe("Fast transit, small hold, rapid short cycles.");
    expect(H.prospectorRunner.transitSpeedMult).toBe(Math.max(...Object.values(H).map((d) => d.transitSpeedMult)));
    expect(H.prospectorRunner.cargoCapacity).toBeLessThan(H.generalFreighter.cargoCapacity);
    expect(H.prospectorMiner.description).toBe("Specialized extraction rig, more materials per tick.");
    expect(H.prospectorMiner.extractionYieldMult).toBeGreaterThan(1);
  });
  it("the destroyer and the carrier", () => {
    expect(H.destroyer.description).toBe("A fast strike hull. Quick shields, fewer guns, closes and hits hard.");
    expect(H.destroyer.transitSpeedMult).toBe(Math.max(...tacticians.map((d) => d.transitSpeedMult)));
    expect(H.destroyer.shieldRecharge).toBe(Math.max(...tacticians.map((d) => d.shieldRecharge)));
    expect(H.destroyer.weaponHardpoints).toBeLessThan(H.battleship.weaponHardpoints);
    expect(H.carrier.description).toBe("A drone platform. Few guns, but launches squadrons that fight for it.");
    expect(H.carrier.weaponHardpoints).toBe(Math.min(...tacticians.map((d) => d.weaponHardpoints)));
    expect(H.carrier.droneBays ?? 0).toBeGreaterThan(0);
  });
});
