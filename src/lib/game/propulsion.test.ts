// Expedition Tiers G2-4 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-4): propulsion, the reach
// gate and frontier sensors. Every gate both sides, the texts as signed off (mockup 2026-10-21), the one drive class
// source (the voyage and the power draw), the classed drive blueprints, and the dispatch order.

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  DRIVE_CLASS_BLUEPRINTS,
  FACILITIES,
  SHIP_TYPES,
  drivesWithinFacilityReach,
  freshState,
  ftlDriveClass,
  type GameState,
  type RegionTier,
  type ShipTypeKey,
} from "./model";
import { candidateReach, candidateSystemById, candidateVoyage, expeditionDispatchBlockText, expeditionSystemGate, startExpedition } from "./expedition";
import {
  DRIVE_CLASS_REACH_MULT,
  FRONTIER_SENSORS,
  buildableDriveClassMax,
  expeditionGateText,
  expeditionReachLy,
  expeditionTierGates,
  hullBaseDriveClass,
  reachCheck,
  shipDriveClass,
  shipFrontierSensors,
  type ExpeditionGateDetail,
} from "./propulsion";
import { effectiveShipStats } from "./crewOverlay";
import { installMissingCombatBaselines, shipTripRangeLightYears } from "./tick";
import { editShip, installPiece, withAwayTeam } from "./wiring/probes";
import { tierNominalSeconds } from "./voyage";
import { craftLineOutputLabel } from "./craftQueue";
import { dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { withoutHeldDrives } from "./propulsionRecallGoldens.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const SHIP = "ship-1";
const on = (hull: ShipTypeKey): GameState => withAwayTeam(installMissingCombatBaselines(editShip(freshState(), { typeKey: hull })));
const drive = (s: GameState, blueprintKey: string | null, extra: Record<string, unknown> = {}): GameState =>
  installPiece(s, { slotType: "ftlDrive", blueprintKey, powerDraw: 4, ...extra });
const ship = (s: GameState) => s.ships.find((x) => x.id === SHIP)!;

describe("G2-4 the drive class: the hull's base plus the installed drive (user G3), one ftlDriveClass source", () => {
  it("hull base class from its tier: Class I for tiers 1 and 2 (every explorer today), II for the tier 3 warships", () => {
    for (const key of Object.keys(SHIP_TYPES) as ShipTypeKey[]) expect(hullBaseDriveClass(key), key).toBe(SHIP_TYPES[key].tier >= 3 ? 2 : 1);
  });

  it("a ship's class: base + the drive's classes above I; Standard Issue, a Class I blueprint or an empty slot add nothing", () => {
    const orion = on("orion");
    expect(shipDriveClass(orion, ship(orion))).toBe(1);
    expect(shipDriveClass(drive(orion, "balancedDriveBp"), ship(orion))).toBe(1);
    expect(shipDriveClass(drive(orion, "classIIDriveBp"), ship(orion))).toBe(2);
    const empty = { ...orion, equipment: orion.equipment.filter((e) => !(e.fittedToShipId === SHIP && e.slotType === "ftlDrive")) };
    expect(shipDriveClass(empty, ship(empty))).toBe(1);
    const battleship = on("battleship");
    expect(shipDriveClass(drive(battleship, "classIIDriveBp"), ship(battleship))).toBe(3);
  });

  it("the voyage freezes the ship's class: a Class II drive halves an Orion's Tier I legs (one rounding step)", () => {
    const one = drive(on("orion"), "balancedDriveBp");
    const two = drive(on("orion"), "classIIDriveBp");
    const cand = candidateSystemById(one, "cand-1-0")!;
    const v1 = candidateVoyage(one, ship(one), cand, false);
    const v2 = candidateVoyage(two, ship(two), cand, false);
    expect(v1.driveClass).toBe(1);
    expect(v2.driveClass).toBe(2);
    expect(Math.abs(v2.outboundSeconds - v1.outboundSeconds / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(v2.returnSeconds - v1.returnSeconds / 2)).toBeLessThanOrEqual(1);
    expect(v1.outboundSeconds).toBeLessThan(tierNominalSeconds(1) * 1.2 + 1);
    const res = startExpedition(two, SHIP, 1, "cand-1-0");
    expect(res.success).toBe(true);
    expect(res.expedition!.voyage).toEqual(v2);
  });

  it("the same class draws the power: a Class II drive draws x1.6 its slot draw on the sheet, rounded up", () => {
    const one = drive(on("orion"), "balancedDriveBp");
    const two = drive(on("orion"), "classIIDriveBp");
    expect(effectiveShipStats(two, ship(two)).powerDraw - effectiveShipStats(one, ship(one)).powerDraw).toBe(Math.ceil(4 * 1.6) - 4);
    expect(ftlDriveClass({ blueprintKey: "classIIDriveBp" })).toBe(2);
  });
});

describe("G2-4 the classed drive blueprints", () => {
  it("one Balanced drive per Class II to VII, on blueprint tier = class; III+ take Deuterium, VI and VII Antimatter", () => {
    expect(DRIVE_CLASS_BLUEPRINTS.map((b) => [b.key, b.driveClass, b.tier])).toEqual([2, 3, 4, 5, 6, 7].map((c) => [`class${["", "I", "II", "III", "IV", "V", "VI", "VII"][c]}DriveBp`, c, c]));
    for (const bp of DRIVE_CLASS_BLUEPRINTS) {
      expect(bp.equipmentOutput).toEqual({ slotType: "ftlDrive", varietyKey: "balancedDrive" });
      expect((bp.recipe.inputs.deuteriumCanister ?? 0) > 0, bp.key).toBe((bp.driveClass ?? 1) >= 3);
      expect((bp.recipe.inputs.antimatterCell ?? 0) > 0, bp.key).toBe((bp.driveClass ?? 1) >= 6);
      expect(bp.label).toMatch(/^Class [IV]+ Drive Blueprint$/);
    }
  });

  // FLIPPED BY OC-15 (the Research Lab and Fabricator tier III to VII rungs, merged 0.14.0): both tracks now reach tier
  // VII, so every classed drive joins BLUEPRINTS (it was Class II only, both tracks stopping at 2) with no other change.
  it("only the rows both facility tracks reach join BLUEPRINTS: Class II to VII since OC-15 (Lab 7, Fabricator 7)", () => {
    const top = Math.min(FACILITIES.research.upgrades.length, FACILITIES.fabricator.upgrades.length);
    expect(top).toBe(7);
    expect(Object.keys(drivesWithinFacilityReach())).toEqual(DRIVE_CLASS_BLUEPRINTS.map((bp) => bp.key));
    for (const bp of DRIVE_CLASS_BLUEPRINTS) expect(BLUEPRINTS[bp.key], bp.key).toBe(bp);
    expect(buildableDriveClassMax()).toBe(7);
    // Read back: with the Class III to VII rows held out (the catalog before OC-15) only Class II is buildable again.
    withoutHeldDrives(() => expect(buildableDriveClassMax()).toBe(2));
  });

  it("the crafted piece names its class (user G20)", () => {
    expect(craftLineOutputLabel("fabricate", "classIIDriveBp")).toMatch(/\(Class II\)$/);
    expect(craftLineOutputLabel("fabricate", "balancedDriveBp")).not.toMatch(/Class/);
  });
});

describe("G2-4 the reach gate (user G4): range x class multiplier x Engineering, against the round trip", () => {
  it("reach = the trip range on the voyage's own round trip x the class multiplier", () => {
    for (const [key, s] of [["classI", drive(on("aurora"), "balancedDriveBp")], ["classII", drive(on("aurora"), "classIIDriveBp")]] as const) {
      const sh = ship(s);
      const cand = candidateSystemById(s, "cand-1-0")!;
      const v = candidateVoyage(s, sh, cand, false);
      const seconds = v.outboundSeconds + v.returnSeconds;
      const want = shipTripRangeLightYears(s, sh, seconds / s.tickDurationSeconds) * DRIVE_CLASS_REACH_MULT[shipDriveClass(s, sh)];
      expect(expeditionReachLy(s, sh, seconds), key).toBe(want);
      expect(candidateReach(s, sh, cand), key).toEqual(reachCheck(s, sh, cand.distanceLy, seconds));
    }
  });

  it("the multiplier grows every class; a stock Class I explorer reaches every Tier I round trip from the farthest homeworld", () => {
    for (let c = 2; c <= 7; c++) expect(DRIVE_CLASS_REACH_MULT[c]).toBeGreaterThan(DRIVE_CLASS_REACH_MULT[c - 1]);
    for (const hull of ["orion", "aurora", "eir"] as const) {
      const s = on(hull);
      expect(expeditionReachLy(s, ship(s), 0), hull).toBeGreaterThanOrEqual(2 * 270);
    }
  });

  it("both sides: a short-tanked Eir is refused outOfReach on a far Tier I system with both numbers; stock it launches", () => {
    const stock = on("eir");
    const cands = [0, 1, 2].map((i) => candidateSystemById(stock, `cand-1-${i}`)!);
    const far = cands.reduce((a, b) => (b.distanceLy > a.distanceLy ? b : a));
    // A drive whose tank line takes most of the hull's 300 away: the reach falls under the far system's round trip.
    const short = drive(stock, "balancedDriveBp", { rolledStats: { fuelCapacity: -290 } });
    const gate = expeditionSystemGate(short, ship(short), far);
    expect(gate?.reason).toBe("outOfReach");
    expect(gate!.roundTripLy).toBe(2 * far.distanceLy);
    expect(gate!.reachLy!).toBeLessThan(gate!.roundTripLy!);
    const refused = startExpedition(short, SHIP, 1, far.id);
    expect(refused).toMatchObject({ success: false, reason: "outOfReach", gate });
    expect(refused.next).toBe(short);
    expect(expeditionGateText(gate!)).toBe(
      `Beyond this ship's reach: ${(2 * far.distanceLy).toLocaleString("en-US")} ly round trip, the ship reaches ${Math.floor(gate!.reachLy!).toLocaleString("en-US")} ly.`,
    );
    expect(expeditionSystemGate(stock, ship(stock), far)).toBeNull();
    expect(startExpedition(stock, SHIP, 1, far.id).success).toBe(true);
  });
});

describe("G2-4 the tier gates: explorer, drive class, frontier sensors (first unmet in that order)", () => {
  it("notExplorer: every non-explorer hull is refused at Tier I with the mockup's text; every explorer passes", () => {
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      const s = on(hull);
      const g = expeditionTierGates(s, ship(s), 1);
      const explorer = SHIP_TYPES[hull].spec === "explorer";
      expect(g.explorer, hull).toBe(explorer);
      expect(g.first?.reason ?? null, hull).toBe(explorer ? null : "notExplorer");
      const res = startExpedition(s, SHIP, 1, "cand-1-0");
      expect(res.success, hull).toBe(explorer);
      if (!explorer) {
        expect(res.reason, hull).toBe("notExplorer");
        expect(res.next, hull).toBe(s);
        expect(expeditionGateText(res.gate!)).toBe("This hull cannot reach any expedition system. Expeditions need an explorer hull.");
      }
    }
  });

  it("notExplorer reports before the candidate, the other gates after it; a refusal never touches the state", () => {
    const freighter = on("generalFreighter");
    expect(startExpedition(freighter, SHIP, 1, "cand-9").reason).toBe("notExplorer");
    expect(startExpedition(on("orion"), SHIP, 1, "cand-9").reason).toBe("noSuchCandidate");
  });

  it("driveClassTooLow at Tier II on Class I (a Class II drive can be built); Class II passes", () => {
    const one = on("orion");
    const g = expeditionTierGates(one, ship(one), 2);
    expect(g).toMatchObject({ driveClass: 1, driveClassNeeded: 2, driveMet: false, driveBuildable: true });
    expect(g.first?.reason).toBe("driveClassTooLow");
    expect(expeditionGateText(g.first!)).toBe("Needs a Class II drive to reach the Orion Arm.");
    expect(startExpedition(one, SHIP, 1, "cand-2-0")).toMatchObject({ success: false, reason: "driveClassTooLow" });
    // With the drive, the next gate is the frontier's sensors (a stock Orion reads under 10); a sensor suite clears it.
    const two = drive(one, "classIIDriveBp");
    expect(expeditionTierGates(two, ship(two), 2).driveMet).toBe(true);
    const seeing = installPiece(two, { slotType: "sensor", implicitStats: { sensors: 10 } });
    expect(expeditionTierGates(seeing, ship(seeing), 2).first).toBeNull();
  });

  // FLIPPED BY OC-15: every class is buildable now, so a Class II ship at Tiers III to VII reads driveClassTooLow.
  // driveClassUnavailable still names a class nothing serves: the catalog without the Class III to VII rows (before
  // OC-15) reads it exactly as before.
  it("driveClassTooLow at Tiers III to VII since OC-15; driveClassUnavailable when no served blueprint gives the class", () => {
    const two = drive(on("orion"), "classIIDriveBp");
    for (const tier of [3, 4, 5, 6, 7] as const) {
      const g = expeditionTierGates(two, ship(two), tier);
      expect(g.first?.reason, `tier ${tier}`).toBe("driveClassTooLow");
      expect(g.driveBuildable).toBe(true);
    }
    withoutHeldDrives(() => {
      for (const tier of [3, 4, 5, 6, 7] as const) {
        const g = expeditionTierGates(two, ship(two), tier);
        expect(g.first?.reason, `tier ${tier}`).toBe("driveClassUnavailable");
        expect(g.driveBuildable).toBe(false);
      }
      const g5 = expeditionTierGates(two, ship(two), 5).first!;
      expect(expeditionGateText(g5)).toBe("Needs a Class V drive. None can be built yet.");
      expect(expeditionGateText({ ...expeditionTierGates(two, ship(two), 3).first! })).toBe("Needs a Class III drive. None can be built yet.");
    });
  });

  it("frontierSensors both sides at Tier III (sensors 20): crew-inclusive sensors as the dispatch snapshot reads them", () => {
    // Complement CP-14 fix round (user 2026-11-04 "Retire the dead gates"): Tier II's 10 is retired (every explorer's
    // base sensors clear it), so Tiers I and II ask for none.
    expect(FRONTIER_SENSORS).toEqual({ 1: 0, 2: 0, 3: 20, 4: 30, 5: 40, 6: 55, 7: 65 });
    const three = drive(on("orion"), "classIIIDriveBp");
    const sensors = shipFrontierSensors(three, ship(three));
    expect(sensors).toBe(effectiveShipStats(three, ship(three)).sensors);
    // A sensor piece that takes the sheet under 20.
    const blind = installPiece(three, { slotType: "sensor", implicitStats: { sensors: 19 - sensors } });
    const g = expeditionTierGates(blind, ship(blind), 3);
    expect(g.sensors).toBe(19);
    expect(g.first?.reason).toBe("frontierSensors");
    expect(expeditionGateText(g.first!)).toBe("Needs sensors 20 to chart the Perseus Arm (this ship reads 19).");
    const enough = installPiece(three, { slotType: "sensor", implicitStats: { sensors: 20 - sensors } });
    expect(expeditionTierGates(enough, ship(enough), 3).first).toBeNull();
    // Tiers I and II ask for none: even a ship reading 0 passes their sensor gate.
    const zero = installPiece(three, { slotType: "sensor", implicitStats: { sensors: -sensors } });
    for (const tier of [1, 2] as const) {
      const t = expeditionTierGates(zero, ship(zero), tier);
      expect(t.sensorsNeeded, `tier ${tier}`).toBe(0);
      expect(t.sensorsMet, `tier ${tier}`).toBe(true);
      expect(t.first, `tier ${tier}`).toBeNull();
    }
  });

  it("no inert frontier gate: every tier at 0 is cleared by the least explorer's own base sensors, every other refuses some bare explorer", () => {
    // Only an explorer can attempt a tier (notExplorer refuses every other hull first), and every sensor lift multiplies
    // by 1 or more, so a bare explorer's base sensors are the floor.
    const explorers = (Object.keys(SHIP_TYPES) as ShipTypeKey[]).filter((k) => SHIP_TYPES[k].spec === "explorer");
    expect(explorers.length).toBeGreaterThan(0);
    const floor = Math.min(...explorers.map((k) => SHIP_TYPES[k].baseSensors ?? 0));
    for (const tier of [1, 2, 3, 4, 5, 6, 7] as const) {
      const need = FRONTIER_SENSORS[tier];
      // A gate at or under the floor could never refuse: it must be retired (0). A live gate must sit above it.
      if (need > 0) expect(need, `tier ${tier}`).toBeGreaterThan(floor);
    }
  });

  it("every reason has a short line (the exhaustive switch) and the texts follow the rules", () => {
    const d = (reason: ExpeditionGateDetail["reason"], tier: RegionTier): ExpeditionGateDetail => ({ reason, tier, driveClass: 1, driveClassNeeded: tier, sensors: 24, sensorsNeeded: 30, roundTripLy: 5420, reachLy: 5280.7 });
    expect(expeditionGateText(d("driveClassTooLow", 3))).toBe("Needs a Class III drive to reach the Perseus Arm.");
    expect(expeditionGateText(d("frontierSensors", 4))).toBe("Needs sensors 30 to chart the Sagittarius Arm (this ship reads 24).");
    expect(expeditionGateText(d("outOfReach", 2))).toBe("Beyond this ship's reach: 5,420 ly round trip, the ship reaches 5,280 ly.");
    for (const r of ["notExplorer", "driveClassUnavailable", "driveClassTooLow", "frontierSensors", "outOfReach"] as const) {
      for (const text of [expeditionDispatchBlockText(r), expeditionGateText(d(r, 3))]) {
        expect(text).not.toMatch(/—|--|warp|Warp| fit|task/);
      }
    }
  });

  it("the pre-G2-4 dispatch writes exactly the record a gated dispatch of a passing ship writes", () => {
    const s = drive(on("aurora"), "classIIDriveBp");
    expect(dispatchPastPropulsion(s, SHIP, 1, "cand-1-1")).toEqual(startExpedition(s, SHIP, 1, "cand-1-1"));
  });
});
