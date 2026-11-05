// Complement CP-14 (G6 part 1): hull base sensors (OC-16 "Explorers lead") and the Science amplification (OC-20
// "Proposed numbers", OC-21 "Multiply"). Plan docs/plans/2026-10-14-complement-and-acquisition-plan.md CP-14.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { HULL_BASE_SENSORS, SHIP_TYPES, shipDerivedStats, type GameState, type ShipTypeKey } from "./model";
import {
  SCIENCE_SEAT_SENSOR_LIFT,
  SCIENCE_SENSOR_CREW_KNEE,
  SCIENCE_SENSOR_CREW_SHARE,
  applyScienceSensorLift,
  effectiveShipStats,
  hullSensorsStamp,
  scienceCrewHeads,
  scienceCrewSensorLift,
  scienceSensorLifts,
} from "./crewOverlay";
import { HULL_FAMILY_MODULE_BONUS, BRIDGE_MODULES } from "./crewModules";
import { officerRankMagnitudeFactor, OFFICER_RANK_ORDER } from "./seniorStaff";
import { dispatchCaptainOnMission, economyTick, tick } from "./tick";
import { missionRunSheet } from "./gearWearEngine";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { deserialize, migrate, serialize } from "./save";
import { stateHash, onHull, withCrew } from "./firstRunsGoldens.fixture";
import { asExpeditionVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { bucketOf, editShip, installPiece, seatOfficer, shipOf, wiringBase, withBuckets, withRefugeePosted } from "./wiring/probes";
import { withCp14Array, withCp14Science } from "./cp14Goldens.fixture";
import { withoutCp14 } from "./cp14Switch.fixture";
import { refugeeFacilityBonus } from "./refugeeBuffs";
import { resolveCrew } from "./crewOverlay";

const bare = (hull: ShipTypeKey): GameState => {
  const s = withBuckets(wiringBase(hull), []);
  return { ...s, equipment: s.equipment.filter((e) => e.fittedToShipId !== "ship-1") };
};
const sensorsOf = (s: GameState): number => effectiveShipStats(s, shipOf(s)).sensors;
const withScienceHeads = (s: GameState, n: number): GameState => withBuckets(s, [bucketOf("science", "sci.survey", n)]);

describe("CP-14 base sensors by hull (OC-16)", () => {
  it("each hull carries the user's numbers: Aurora 35, Orion 25, Eir 15, warships 10, others 0", () => {
    expect(HULL_BASE_SENSORS).toEqual({ aurora: 35, orion: 25, eir: 15, destroyer: 10, battleship: 10, carrier: 10 });
    const want: Record<ShipTypeKey, number> = {
      aurora: 35, orion: 25, eir: 15, destroyer: 10, battleship: 10, carrier: 10,
      generalFreighter: 0, prospectorHauler: 0, prospectorRunner: 0, prospectorMiner: 0,
    };
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      expect(sensorsOf(bare(hull)), hull).toBe(want[hull]);
      expect(shipDerivedStats(shipOf(bare(hull))).sensors, hull).toBe(want[hull]);
    }
  });

  it("a hull without the field is unchanged, and the switch off returns every hull to 0", () => {
    for (const hull of ["generalFreighter", "prospectorHauler", "prospectorRunner", "prospectorMiner"] as ShipTypeKey[]) {
      expect(SHIP_TYPES[hull].baseSensors, hull).toBeUndefined();
      expect(effectiveShipStats(bare(hull), shipOf(bare(hull)))).toEqual(withoutCp14(() => effectiveShipStats(bare(hull), shipOf(bare(hull)))));
    }
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) expect(withoutCp14(() => sensorsOf(bare(hull))), hull).toBe(0);
  });

  it("the base adds flat with a Sensor Suite's points, before any lift", () => {
    const s = withCp14Array(bare("orion"));
    expect(sensorsOf(s)).toBe(25 + 20);
    expect(effectiveShipStats(s, shipOf(s), { hullSensors: false }).sensors).toBe(20);
  });
});

describe("CP-14 Science amplification (OC-20, OC-21)", () => {
  it("is exactly zero with no Science crew and no Science officer (the sheet comes back itself)", () => {
    const s = bare("aurora");
    expect(scienceSensorLifts(s, shipOf(s))).toEqual({ crew: 0, seat: 0 });
    const crewed = withBuckets(s, [bucketOf("operations", "ops.unloadSpeed"), bucketOf("engineering", "eng.range")]);
    expect(scienceCrewHeads(crewed, shipOf(crewed))).toBe(0);
    expect(sensorsOf(crewed)).toBe(35);
    const sheet = effectiveShipStats(s, shipOf(s));
    expect(applyScienceSensorLift(sheet, { crew: 0, seat: 0 })).toBe(sheet);
  });

  it("the crew lift is 8% x ln(1 + heads / 25): unbounded, concave, never capped (D23)", () => {
    expect(SCIENCE_SENSOR_CREW_SHARE).toBe(0.08);
    expect(SCIENCE_SENSOR_CREW_KNEE).toBe(25);
    expect(scienceCrewSensorLift(0)).toBe(0);
    expect(scienceCrewSensorLift(25)).toBeCloseTo(0.08 * Math.log(2), 12);
    let prev = 0;
    let prevStep = Infinity;
    for (const n of [10, 50, 100, 500, 1000, 5000, 1e5, 1e7]) {
      const v = scienceCrewSensorLift(n);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    for (let n = 25; n <= 2000; n += 25) {
      const step = scienceCrewSensorLift(n) - scienceCrewSensorLift(n - 25);
      expect(step).toBeLessThan(prevStep);
      prevStep = step;
    }
    expect(scienceCrewSensorLift(1e7)).toBeGreaterThan(0.9); // no ceiling: it keeps climbing
  });

  it("counts the Science division and its assigned notables, and multiplies the sensors by it", () => {
    const s = withScienceHeads(bare("aurora"), 40);
    expect(scienceCrewHeads(s, shipOf(s))).toBe(40);
    expect(sensorsOf(s)).toBeCloseTo(35 * (1 + scienceCrewSensorLift(40)), 10);
    const notable = { ...s, notableCrew: [{ ...(s.notableCrew[0] ?? {}), id: "n-1", profession: "science", rarity: "standard", rank: 1, race: "belter", buff1Id: "sci.survey", buff2Id: null, name: "N", assignedShipId: "ship-1" }] } as unknown as GameState;
    expect(scienceCrewHeads(notable, shipOf(notable))).toBe(41);
  });

  it("the Science seat is +12% at Ensign, growing with rank", () => {
    for (const rank of OFFICER_RANK_ORDER) {
      const seated = seatOfficer(bare("aurora"), "science", []);
      const s = { ...seated, officers: seated.officers.map((o) => ({ ...o, rank })) };
      expect(scienceSensorLifts(s, shipOf(s)).seat, rank).toBeCloseTo(SCIENCE_SEAT_SENSOR_LIFT * officerRankMagnitudeFactor(rank), 12);
      expect(sensorsOf(s), rank).toBeCloseTo(35 * (1 + SCIENCE_SEAT_SENSOR_LIFT * officerRankMagnitudeFactor(rank)), 10);
    }
    // Another seat lifts nothing.
    const other = seatOfficer(bare("aurora"), "medical", []);
    expect(scienceSensorLifts(other, shipOf(other)).seat).toBe(0);
  });

  it("Focused Command amplifies the seat only on explorer and prospector hulls", () => {
    const amp = BRIDGE_MODULES.find((m) => m.kind === "focused")!.amp;
    const seat = SCIENCE_SEAT_SENSOR_LIFT;
    const focused = (hull: ShipTypeKey) => installPiece(seatOfficer(withCp14Array(bare(hull)), "science", []), { slotType: "bridge", moduleVariant: "bridgeFocusedCommand" });
    for (const hull of ["aurora", "prospectorMiner"] as ShipTypeKey[]) {
      const s = focused(hull);
      expect(scienceSensorLifts(s, shipOf(s)).seat, hull).toBeCloseTo(seat * (1 + amp), 12);
    }
    for (const hull of ["destroyer", "generalFreighter"] as ShipTypeKey[]) {
      const s = focused(hull);
      expect(scienceSensorLifts(s, shipOf(s)).seat, hull).toBeCloseTo(seat, 12);
    }
  });

  it("a ship with no sensors stays at 0 whatever its Science people", () => {
    const s = withCp14Science(bare("generalFreighter"));
    expect(sensorsOf(s)).toBe(0);
  });

  it("stacks multiplicatively with the array, CP-13's Explorer bridge line and the museum-free sheet (OC-21)", () => {
    // An Aurora with a 20-point array, 50 Science crew, a Lieutenant Science officer and a Balanced Command bridge.
    const s = installPiece(withCp14Science(withCp14Array(bare("aurora"))), { slotType: "bridge", moduleVariant: "bridgeBalancedCommand" });
    const balanced = BRIDGE_MODULES.find((m) => m.kind === "balanced")!.amp;
    const explorerLine = HULL_FAMILY_MODULE_BONUS.explorer.bridge.sensors ?? 0;
    expect(explorerLine).toBeGreaterThan(0);
    const heads = scienceCrewHeads(s, shipOf(s));
    expect(heads).toBe(50);
    const want = (35 + 20) * (1 + scienceCrewSensorLift(heads)) * (1 + SCIENCE_SEAT_SENSOR_LIFT * officerRankMagnitudeFactor("lieutenant") * (1 + balanced)) * (1 + explorerLine);
    expect(sensorsOf(s)).toBeCloseTo(want, 9);
  });

  it("the Stargazer's discovery odds ride the same frozen snapshot, untouched by the sensors", () => {
    const base = asExpeditionVeteran(withCrew(onHull("orion"), "d18"));
    const posted = withRefugeePosted({ ...base, facilities: { ...base.facilities, subspaceTelescope: { ...(base.facilities.subspaceTelescope ?? { level: 0 }), level: Math.max(1, base.facilities.subspaceTelescope?.level ?? 0) } } } as GameState, "stargazer", "subspaceTelescope");
    const kit = withCp14Science(withCp14Array(posted));
    const b = refugeeFacilityBonus(kit, "subspaceTelescope");
    expect(b).toBeGreaterThan(0);
    const res = dispatchPastPropulsion(kit, "ship-1", 1, "cand-0");
    expect(res.success, String(res.reason)).toBe(true);
    const exp = res.expedition!;
    expect(exp.sensorPower).toBeCloseTo(sensorsOf(kit), 9);
    expect(exp.sensorPower).toBeGreaterThan(25 + 20);
    const off = withoutCp14(() => dispatchPastPropulsion(kit, "ship-1", 1, "cand-0").expedition!);
    expect(off.sensorPower).toBe(20);
    expect(exp.scanParams).toEqual(off.scanParams);
    expect(exp.scanParams.landmarkOddsBias).toBeGreaterThan(0);
  });
});

describe("CP-14 determinism: the hullSensors stamp", () => {
  const surveyBase = (hull: ShipTypeKey, kit: boolean): GameState => {
    const s0 = onHull(hull);
    const s = kit ? withCp14Science(withCp14Array(s0)) : s0;
    return { ...s, credits: new Decimal(1_000_000), captains: s.captains.map((c) => ({ ...c, level: 10 })) };
  };

  it("a survey dispatched now on a ship the slice moves carries it; a run it cannot move does not", () => {
    const orion = dispatchCaptainOnMission(surveyBase("orion", true), 1, "surveyMineralAnomaly");
    expect(orion.success).toBe(true);
    expect((orion.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBe(1);
    const ore = dispatchCaptainOnMission(surveyBase("orion", true), 1, "shortOreRun");
    expect((ore.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBeUndefined();
    const freighter = dispatchCaptainOnMission(surveyBase("generalFreighter", false), 1, "surveyMineralAnomaly");
    expect((freighter.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBeUndefined();
    const s = surveyBase("generalFreighter", false);
    expect(hullSensorsStamp(s, shipOf(s), true)).toBeUndefined();
    expect(withoutCp14(() => hullSensorsStamp(surveyBase("orion", true), shipOf(surveyBase("orion", true)), true))).toBeUndefined();
  });

  it("only a stamped run's sheet reads the base and the Science lift (a run from before reads as it did)", () => {
    const r = dispatchCaptainOnMission(surveyBase("orion", true), 1, "surveyMineralAnomaly");
    const m = r.next.captains[0].mission!;
    if (m.kind !== "extraction") throw new Error("not a mission");
    const stamped = missionRunSheet(r.next, shipOf(r.next), m).sensors;
    const { hullSensors: _h, ...unstamped } = m as typeof m & { hullSensors?: 1 };
    expect(stamped).toBeCloseTo(sensorsOf(r.next), 9);
    expect(missionRunSheet(r.next, shipOf(r.next), unstamped).sensors).toBe(20);
  });

  it("offline == live and chunked == 1 s steps for a stamped survey and a stamped short-range run", () => {
    const r = dispatchCaptainOnMission(surveyBase("orion", true), 1, "surveyMineralAnomaly");
    let live = r.next;
    for (let i = 0; i < 1500; i++) live = economyTick(live, 1, () => 0.5);
    let chunked = r.next;
    for (let i = 0; i < 3; i++) chunked = tick(500, chunked, () => 0.5); // the offline catch-up (tick) in 500 s spans
    expect(stateHash(chunked)).toBe(stateHash(live));

    const eir = withCp14Science(withCp14Array(resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 })));
    const sr = dispatchCaptainOnShortRange(eir, 1, 0);
    expect(sr.success, String(sr.reason)).toBe(true);
    expect((sr.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBe(1);
    let srLive = sr.next;
    for (let i = 0; i < 1200; i++) srLive = economyTick(srLive, 1, () => 0.5);
    let srChunk = sr.next;
    for (let i = 0; i < 4; i++) srChunk = tick(300, srChunk, () => 0.5);
    expect(stateHash(srChunk)).toBe(stateHash(srLive));
  });

  it("one economyTick call == 997 s chunks == 1 s steps for a stamped short-range run and a stamped survey", () => {
    const rng = () => 0.5;
    // `discovered` is a set kept in first-seen order, and one call sees a cycle's finds in another order than 1 s steps
    // (the emodEm4.test.ts precedent sorts it): compared sorted.
    const hashOf = (s: GameState): string => stateHash({ ...s, discovered: [...s.discovered].sort() });
    const stepped = (s: GameState, n: number): GameState => {
      let out = s;
      for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
      return out;
    };
    const chunked = (s: GameState, n: number, size = 997): GameState => {
      let out = s;
      for (let left = n; left > 0; left -= size) out = economyTick(out, Math.min(size, left), rng);
      return out;
    };
    const eir = withCp14Science(withCp14Array(resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 })));
    const sr = dispatchCaptainOnShortRange(eir, 1, 0);
    expect(sr.success, String(sr.reason)).toBe(true);
    expect((sr.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBe(1);
    const srSteps = stepped(sr.next, 2400);
    expect(hashOf(chunked(sr.next, 2400))).toBe(hashOf(srSteps));
    expect(hashOf(economyTick(sr.next, 2400, rng))).toBe(hashOf(srSteps));

    // An extraction claims its transit berths from a PER-CALL budget (tick.ts, 0.13.4), so a call spanning more than one
    // of its homecomings holds it at a berth, with or without CP-14 (production and the offline catch-up both step
    // economyTick(state, 1)). The survey's cycle is shorter than 997 s, so its chunks and its one call each stay within
    // one homecoming (the emodEm4.test.ts precedent: 97 s chunks).
    const r = dispatchCaptainOnMission(surveyBase("orion", true), 1, "surveyMineralAnomaly");
    expect((r.next.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBe(1);
    const surveySteps = stepped(r.next, 1994);
    expect(Number(surveySteps.lifetimeStats.missionsCompleted.surveyMineralAnomaly ?? 0)).toBeGreaterThan(3);
    expect(hashOf(chunked(r.next, 1994, 97))).toBe(hashOf(surveySteps));
    expect(hashOf(economyTick(r.next, 120, rng))).toBe(hashOf(stepped(r.next, 120)));
  });

  it("the stamp survives a save round trip, and a malformed short-range stamp is refused", () => {
    const r = dispatchCaptainOnMission(surveyBase("orion", true), 1, "surveyMineralAnomaly");
    const raw = deserialize(serialize(r.next, 0, 0));
    expect(raw).not.toBeNull();
    const loaded = migrate(raw!);
    expect((loaded.captains[0].mission as { hullSensors?: 1 }).hullSensors).toBe(1);
    const eir = withCp14Science(withCp14Array(resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 })));
    const sr = dispatchCaptainOnShortRange(eir, 1, 0);
    const bad = { ...sr.next, captains: sr.next.captains.map((c, i) => (i === 0 ? { ...c, mission: { ...c.mission!, hullSensors: 2 } } : c)) } as unknown as GameState;
    const backRaw = deserialize(serialize(bad, 0, 0));
    const back = backRaw === null ? null : migrate(backRaw);
    expect((back?.captains[0].mission as { hullSensors?: unknown } | null)?.hullSensors).not.toBe(2);
  });
});
