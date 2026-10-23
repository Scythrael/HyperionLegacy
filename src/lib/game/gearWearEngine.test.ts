// GEAR WEAR step 3 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 11 step 3): the use wear sources, the
// repair contexts and the settling, through the real engine. The wiring registry's sensitivity level proves every
// source, context, bonus and consumer at its configured magnitude (wiring/wearProbes.ts); this file proves the rules
// around them: offline == live across settles, the frozen run gear, the in-flight and training runs, the gates that
// never read a worn value, the save, and the section 3.4 targets the approved raws were tuned to.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type CaptainMissionState, type EquipmentInstance, type GameState, type MissionKey, type ShortRangeMissionState } from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, installMissingCombatBaselines, shipRangeLightYears, tick, tickCaptainMission } from "./tick";
import { CONDITION_FULL, REPAIR_RATES, USE_WEAR_FLOOR, pieceCondition, withPieceCondition, wornGearView } from "./gearWear";
import { emptyWearEvents, expeditionWear, livePieceCondition, missionCycleWear, recordExpeditionWear, resolveGearWear, runShipStats, runWearStamp } from "./gearWearEngine";
import { effectiveShipStats } from "./crewOverlay";
import { quartersCapacityBonus } from "./crewModules";
import { canFitEquipment } from "./equipment";
import { shortRangeShipRatings } from "./shortRange";
import { shortRangeBoardSlots, shortRangeNextCycle, startShortRangeCycle } from "./shortRangeBoard";
import { advanceExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { deserialize, migrate, serialize } from "./save";
import { WIRING_SHIP_ID, installPiece, onMission, playerCombatant, seatOfficer, shipOf, wiringBase, withAwayTeam } from "./wiring/probes";
import { afterExpeditionTraining, inShipyardBay, wearPieceIdFor, withFixtureCondition } from "./wiring/wearProbes";
import { withGearWearOff } from "./gearWearSwitch.fixture";

const RNG = () => 0.5;

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

function shipPieces(s: GameState): EquipmentInstance[] {
  return s.equipment.filter((e) => e.fittedToShipId === WIRING_SHIP_ID);
}

// A Standard-Issue freighter (combat baselines in), crew aboard, Mission Control open, credits to spare.
function fleetBase(): GameState {
  const s = installMissingCombatBaselines(seatOfficer(wiringBase(), "operations", []));
  return { ...s, captains: s.captains.map((c) => ({ ...c, level: 10 })) };
}

function dispatched(s: GameState, key: MissionKey): GameState {
  const r = dispatchCaptainOnMission(s, 1, key);
  expect(r.success, `${key}: ${r.reason}`).toBe(true);
  return r.next;
}

describe("gear wear step 3: the use wear sources (each kind its own way, at its run's own events)", () => {
  it("a delivered mission cycle wears the hold, the drive, the reactor and the rig; the weapons and defenses never wear by use", () => {
    let s = dispatched(fleetBase(), "shortOreRun");
    expect((s.captains[0].mission as CaptainMissionState).gearWear).toEqual({ version: 1 });
    s = stepped(s, 400);
    const worn = new Map<string, number>(shipPieces(s).map((e) => [e.slotType, pieceCondition(e)]));
    for (const slot of ["cargoBay", "ftlDrive", "reactorCore"]) expect(worn.get(slot), slot).toBeLessThan(CONDITION_FULL);
    for (const slot of ["weapon", "shieldEmitters", "hullPlating"]) expect(worn.get(slot), slot).toBe(CONDITION_FULL);
  });

  it("use alone never takes a piece below the use floor (user W2 Gentle), however hard it is used", () => {
    const fragile = installPiece(fleetBase(), { slotType: "cargoBay", durabilityMax: 1, implicitStats: { cargoCapacity: 20 } });
    let s = dispatched(fragile, "localFuelRun");
    for (let h = 0; h < 4; h++) {
      s = economyTick(s, 900, RNG);
      const hold = s.equipment.find((e) => e.id === wearPieceIdFor("cargoBay"))!;
      expect(pieceCondition(hold)).toBeGreaterThanOrEqual(USE_WEAR_FLOOR);
    }
    const hold = s.equipment.find((e) => e.id === wearPieceIdFor("cargoBay"))!;
    expect(pieceCondition(hold)).toBeLessThan(700); // it really was used hard
  });

  it("a mission in flight from before step 3 (no stamp) wears nothing and stays byte-identical", () => {
    const s0 = onMission(fleetBase(), "shortOreRun", "ordersReceived");
    expect((s0.captains[0].mission as CaptainMissionState).gearWear).toBeUndefined();
    const on = stepped(s0, 600);
    const off = withGearWearOff(() => stepped(s0, 600));
    expect(on).toEqual(off);
    expect(shipPieces(on).every((e) => e.condition === undefined)).toBe(true);
  });

  it("a short-range training cycle wears nothing (user W9); its first ordinary cycle does", () => {
    const base = fleetBase();
    const s0: GameState = { ...base, facilities: { ...base.facilities, missionControl: { ...base.facilities.missionControl, level: 9 } } };
    const slot = shortRangeBoardSlots(s0)[0];
    const wear = runWearStamp(s0, WIRING_SHIP_ID);
    const start = startShortRangeCycle(s0, shipOf(s0), slot, shortRangeNextCycle(s0, slot.id), wear, true);
    expect(start.roll.difficulty.firstRun).toBe(true);
    const mission: ShortRangeMissionState = { kind: "shortRange", slotId: slot.id, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false, gearWear: wear };
    let s: GameState = { ...s0, captains: s0.captains.map((c, i) => (i === 0 ? { ...c, mission } : c)), runCounts: start.runCounts };
    s = stepped(s, start.plan.totalTicks + 1);
    const cycles = s.captains[0].mission as ShortRangeMissionState;
    expect(cycles.cyclesThisRun).toBe(1);
    // The training cycle delivered: only underway upkeep could act, and nothing was worn to repair.
    expect(shipPieces(s).every((e) => e.condition === undefined)).toBe(true);
    s = stepped(s, 3000);
    expect(shipPieces(s).some((e) => e.condition !== undefined)).toBe(true);
  });

  it("an expedition's training run is never stamped (W9); an ordinary run is, and comes home with its ship's and members' use", () => {
    // The training run is an explorer's first expedition (safe first runs SF-2).
    const ready = withAwayTeam(installPiece(wiringBase("orion"), { slotType: "reactorCore", durabilityMax: 100 }));
    const train = startExpedition(ready, WIRING_SHIP_ID, 1, expeditionCandidates(ready, WIRING_SHIP_ID)[0].id, true, undefined, false);
    expect(train.expedition?.difficulty?.firstRun).toBe(true);
    expect(train.expedition?.gearWear).toBeUndefined();
    const ordinary = afterExpeditionTraining(ready);
    const res = startExpedition(ordinary, WIRING_SHIP_ID, 1, expeditionCandidates(ordinary, WIRING_SHIP_ID)[0].id, true, undefined, false);
    expect(res.expedition?.gearWear).toEqual({ version: 1, dispatchedAt: ordinary.gameTimeSeconds });
    const done = advanceExpedition(res.expedition!, res.expedition!.phaseAnchorSeconds + 1e9);
    const home: GameState = { ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] };
    const events = emptyWearEvents();
    recordExpeditionWear(res.next, home, events);
    const after = resolveGearWear(res.next, home, events);
    const reactor = after.equipment.find((e) => e.id === wearPieceIdFor("reactorCore"))!;
    expect(pieceCondition(reactor)).toBeLessThan(CONDITION_FULL);
    expect(pieceCondition(reactor)).toBeGreaterThanOrEqual(USE_WEAR_FLOOR);
    expect(events.members.size).toBeGreaterThan(0);
  });
});

describe("gear wear step 3: the repair contexts and the settling", () => {
  const worn = (s: GameState) => withFixtureCondition(installPiece(s, { slotType: "cargoBay", durabilityMax: 100 }), "cargoBay", 700);
  const hold = (s: GameState) => pieceCondition(s.equipment.find((e) => e.id === wearPieceIdFor("cargoBay"))!);

  it("at home a worn piece recovers at the home rate, free, back to pristine (both fields removed)", () => {
    let s = worn(wiringBase());
    s = stepped(s, 60);
    expect(hold(s)).toBe(700 + REPAIR_RATES.home);
    s = stepped(s, 600);
    const piece = s.equipment.find((e) => e.id === wearPieceIdFor("cargoBay"))!;
    expect(piece.condition).toBeUndefined();
    expect(piece.conditionAt).toBeUndefined();
  });

  it("a piece underway does not change between its run's events (the run sheet is constant), and settles as the run ends", () => {
    let s = onMission(worn(wiringBase()), "longOreRun", "transitOut");
    const at0 = hold(s);
    s = stepped(s, 30);
    expect(hold(s)).toBe(at0); // lazy: nothing was settled mid-run (no stamp: no wear event either)
    // Read it live without writing: the underway upkeep since the anchor.
    const live = livePieceCondition(s, s.equipment.find((e) => e.id === wearPieceIdFor("cargoBay"))!);
    expect(live).toBe(700 + Math.floor((REPAIR_RATES.underway * 30) / 60));
  });

  it("a spare in storage recovers at home; a piece on a damaged hull in a Shipyard bay recovers at the bay rate", () => {
    const spare = { ...worn(wiringBase()) };
    const asSpare: GameState = { ...spare, equipment: spare.equipment.map((e) => (e.id === wearPieceIdFor("cargoBay") ? { ...e, fittedToShipId: null } : e)) };
    expect(hold(stepped(asSpare, 60))).toBe(700 + REPAIR_RATES.home);
    // The hull's own repair (W6: its own Shipyard system) is untouched; its gear rides the faster bay rate meanwhile.
    const bay = inShipyardBay(worn(wiringBase()));
    expect(bay.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    expect(hold(stepped(bay, 60))).toBe(700 + REPAIR_RATES.shipyardBay);
  });
});

describe("gear wear step 3: offline == live across settles", () => {
  // A mixed fleet with worn gear: ship-1 on a stamped mission Repeat (its gear worn mid-run), a worn spare at home.
  function mixed(): GameState {
    const s = dispatched(fleetBase(), "shortOreRun");
    const spare: EquipmentInstance = { ...shipPieces(s).find((e) => e.slotType === "cargoBay")!, id: "gw-spare", fittedToShipId: null };
    return { ...s, equipment: [...s.equipment, withPieceCondition(spare, 650, s.gameTimeSeconds)] };
  }

  it("tick() (the offline catch-up) equals the live 1 s steps over two hours", () => {
    const s0 = mixed();
    const live = stepped(s0, 7200);
    const offline = tick(7200, s0, RNG);
    expect(offline.equipment).toEqual(live.equipment);
    expect(offline).toEqual(live);
  });

  // A short-range run is the engine whose whole state is chunk-invariant (shortRangeCycle.test.ts; a captain mission
  // draws its transit berths from a per-call budget, so ITS cycles differ in one long call, which production never
  // makes): a stamped Repeat run with a worn spare at home.
  function shortRangeFleet(): GameState {
    const base = fleetBase();
    const s0: GameState = { ...base, facilities: { ...base.facilities, missionControl: { ...base.facilities.missionControl, level: 9 } } };
    const slot = shortRangeBoardSlots(s0)[0];
    const wear = runWearStamp(s0, WIRING_SHIP_ID);
    const start = startShortRangeCycle(s0, shipOf(s0), slot, shortRangeNextCycle(s0, slot.id), wear, true);
    const mission: ShortRangeMissionState = { kind: "shortRange", slotId: slot.id, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false, gearWear: wear };
    const s: GameState = { ...s0, captains: s0.captains.map((c, i) => (i === 0 ? { ...c, mission } : c)), runCounts: start.runCounts };
    const spare: EquipmentInstance = { ...shipPieces(s).find((e) => e.slotType === "cargoBay")!, id: "gw-spare", fittedToShipId: null };
    return { ...s, equipment: [...s.equipment, withPieceCondition(spare, 650, s.gameTimeSeconds)] };
  }

  it("one call, 997 s chunks and 1 s steps leave every piece identical (each event at its own instant)", () => {
    const s0 = shortRangeFleet();
    const N = 3000;
    const once = economyTick(s0, N, RNG);
    let chunks = s0;
    for (let left = N; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), RNG);
    const steps = stepped(s0, N);
    expect(steps.equipment.some((e) => e.id !== "gw-spare" && e.condition !== undefined)).toBe(true);
    expect(chunks.equipment).toEqual(steps.equipment);
    expect(once.equipment).toEqual(steps.equipment);
  });
});

describe("gear wear step 3: a Repeat run re-reads its gear at each cycle start (user 2026-10-21, Re-read each cycle)", () => {
  // A crafted hold (Standard Issue lines fold to nothing, so wear on them moves nothing).
  const lined = () => installPiece(fleetBase(), { slotType: "cargoBay", durabilityMax: 100, implicitStats: { cargoCapacity: 40 } });

  it("a run dispatched with worn gear folds it for its first cycle, constant until that cycle delivers", () => {
    const base = lined();
    const hold = shipPieces(base).find((e) => e.slotType === "cargoBay")!;
    const worn: GameState = { ...base, equipment: base.equipment.map((e) => (e.id === hold.id ? withPieceCondition(e, USE_WEAR_FLOOR, base.gameTimeSeconds) : e)) };
    let s = dispatched(worn, "shortOreRun");
    const stamp = (s.captains[0].mission as CaptainMissionState).gearWear!;
    expect(stamp.frozen).toEqual({ [hold.id]: USE_WEAR_FLOOR });
    const ship = shipOf(s);
    const sheet0 = runShipStats(s, ship, stamp, true);
    expect(sheet0.cargoCapacity).toBeLessThan(effectiveShipStats(base, ship).cargoCapacity);
    s = stepped(s, 60); // mid-cycle: the stamp has not moved
    expect((s.captains[0].mission as CaptainMissionState).gearWear).toEqual(stamp);
  });

  it("worn gear shows from cycle 2: the first delivery re-freezes the stamp and the next cycle folds the wear", () => {
    let s = dispatched(lined(), "shortOreRun");
    expect((s.captains[0].mission as CaptainMissionState).gearWear).toEqual({ version: 1 });
    const ship = shipOf(s);
    const sheet0 = runShipStats(s, ship, { version: 1 }, true);
    for (let i = 0; i < 2000 && Number(s.lifetimeStats.missionsCompleted.shortOreRun ?? 0) < 1; i++) s = economyTick(s, 1, RNG);
    const stamp = (s.captains[0].mission as CaptainMissionState).gearWear!;
    expect(Object.keys(stamp.frozen ?? {}).length).toBeGreaterThan(0);
    const hold = shipPieces(s).find((e) => e.slotType === "cargoBay")!;
    expect(stamp.frozen?.[hold.id]).toBe(pieceCondition(hold));
    expect(runShipStats(s, ship, stamp, true).cargoCapacity).toBeLessThan(sheet0.cargoCapacity);
  });

  it("a re-read that returns the same sheet is byte-identical (the refold uses the declarations' expressions)", () => {
    for (const key of ["shortOreRun", "surveyMineralAnomaly", "frontierSupplyRun"] as MissionKey[]) {
      const s = { ...onMission(lined(), key, "ordersReceived"), credits: new Decimal(1e9) };
      const captain = s.captains[0];
      const stats = runShipStats(s, shipOf(s), undefined, true);
      const plain = tickCaptainMission(5000, captain, RNG, {}, stats, Infinity, 0, 1e9, undefined, Infinity, 1);
      const reread = tickCaptainMission(5000, captain, RNG, {}, stats, Infinity, 0, 1e9, undefined, Infinity, 1, () => ({ stats, gearWear: { version: 1 } }));
      const strip = (r: typeof plain) => ({ ...r, captain: { ...r.captain, mission: r.captain.mission && { ...r.captain.mission, gearWear: undefined } } });
      expect(Number(plain.lifetimeStatsDelta.missionsCompleted[key] ?? 0), key).toBeGreaterThan(1);
      expect(JSON.stringify(strip(reread)), key).toBe(JSON.stringify(strip(plain)));
    }
  });

  it("the cycle wear reads the run sheet's own cycle length (missionCycleWear)", () => {
    const s = fleetBase();
    const w = missionCycleWear("shortOreRun", runShipStats(s, shipOf(s), runWearStamp(s, WIRING_SHIP_ID), true), 1, true);
    expect(w.hauls).toBe(1);
    expect(w.minutesUnderway).toBeGreaterThan(1);
    expect(w.lightYears).toBeGreaterThan(0);
  });
});

describe("gear wear step 3: what wear never touches (design 4.3, the peace rule)", () => {
  // Every piece of ship-1 that wears by use at 0 condition, worse than use alone can ever take it: the gates read the
  // stored (pristine) sheet. (Weapons and defenses wear by battle only, step 4.)
  const USE_SLOTS = new Set(["cargoBay", "ftlDrive", "reactorCore", "specUtility", "sensor", "bridge", "quarters"]);
  function allWorn(s: GameState): GameState {
    return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === WIRING_SHIP_ID && USE_SLOTS.has(e.slotType) ? withPieceCondition(e, 0, s.gameTimeSeconds) : e)) };
  }

  it("reach, the dispatch gate and the ship sheet read pristine; only a run's own readers see wear", () => {
    const lined = installPiece(fleetBase(), { slotType: "ftlDrive", implicitStats: { fuelCapacity: 40, engineEfficiency: 20, transitSpeedMult: 20 } });
    const s = installPiece(lined, { slotType: "cargoBay", implicitStats: { cargoCapacity: 40 } });
    const w = allWorn(s);
    const ship = shipOf(s);
    expect(shipRangeLightYears(w, ship)).toBe(shipRangeLightYears(s, ship));
    expect(canDispatch(w, 1, "longOreRun")).toEqual(canDispatch(s, 1, "longOreRun"));
    expect(effectiveShipStats(w, ship)).toEqual(effectiveShipStats(s, ship));
    expect(shortRangeShipRatings(w, ship, 1)).toEqual(shortRangeShipRatings(s, ship, 1));
    expect(runShipStats(w, ship, runWearStamp(w, WIRING_SHIP_ID), true).cargoCapacity).toBeLessThan(effectiveShipStats(s, ship).cargoCapacity);
  });

  it("the patrol combatant (combat is step 4's) and the install gate never read a worn value", () => {
    const s = installMissingCombatBaselines(wiringBase("destroyer"));
    const w = allWorn(s);
    expect(playerCombatant(w)).toEqual(playerCombatant(s));
    const spare: EquipmentInstance = { ...shipPieces(s).find((e) => e.slotType === "reactorCore")!, id: "gw-reactor", fittedToShipId: null };
    const withSpare = (x: GameState) => ({ ...x, equipment: [...x.equipment, spare] });
    const old = shipPieces(s).find((e) => e.slotType === "reactorCore")!.id;
    expect(canFitEquipment(withSpare(w), WIRING_SHIP_ID, "gw-reactor", old)).toEqual(canFitEquipment(withSpare(s), WIRING_SHIP_ID, "gw-reactor", old));
  });

  it("crew station counts never move (a quarters module's capacity is a count)", () => {
    const s = installPiece(wiringBase(), { slotType: "quarters", moduleVariant: "quartersEfficient" });
    const worn = withFixtureCondition(s, "quarters", 0);
    expect(quartersCapacityBonus(wornGearView(worn), shipOf(worn))).toBe(quartersCapacityBonus(s, shipOf(s)));
  });
});

describe("gear wear step 3: the save carries every stamp and tally", () => {
  it("a stamped mission with frozen gear, worn pieces and their anchors round-trip byte for byte", () => {
    const base = fleetBase();
    const hold = shipPieces(base).find((e) => e.slotType === "cargoBay")!;
    const worn: GameState = { ...base, equipment: base.equipment.map((e) => (e.id === hold.id ? withPieceCondition(e, 700, 0) : e)) };
    const s = stepped(dispatched(worn, "shortOreRun"), 300);
    const back = migrate(deserialize(serialize(s, 0, 0))!);
    expect(back.captains[0].mission).toEqual(s.captains[0].mission);
    expect(back.equipment).toEqual(s.equipment);
  });

  it("an ordinary expedition's stamp and its ground tally round-trip", () => {
    const ready = afterExpeditionTraining(withAwayTeam(wiringBase()));
    const res = startExpedition(ready, WIRING_SHIP_ID, 1, expeditionCandidates(ready, WIRING_SHIP_ID)[0].id, true, undefined, false);
    const mid = advanceExpedition(res.expedition!, res.expedition!.phaseAnchorSeconds + 200_000);
    const s: GameState = { ...res.next, gameTimeSeconds: res.expedition!.phaseAnchorSeconds + 200_000, expeditions: [mid] };
    const back = migrate(deserialize(serialize(s, 0, 0))!);
    expect(back.expeditions[0].gearWear).toEqual(mid.gearWear);
    expect(back.expeditions[0].groundOps?.wearTally).toEqual(mid.groundOps?.wearTally);
  });
});

describe("gear wear step 3: the section 3.4 targets the approved raws were tuned to", () => {
  it("a Standard-Issue freighter on Repeat on the starter mission settles near 90% on use alone (every worn kind Sound)", () => {
    let s = dispatched(installMissingCombatBaselines({ ...freshState(), credits: new Decimal(0), captains: freshState().captains.map((c) => ({ ...c, level: 10 })) }), "shortOreRun");
    s = stepped(s, 6 * 3600);
    const worn = shipPieces(s).filter((e) => e.condition !== undefined).map((e) => pieceCondition(e));
    expect(worn.length).toBeGreaterThanOrEqual(3);
    for (const c of worn) expect(c).toBeGreaterThanOrEqual(800);
    const all = shipPieces(s).filter((e) => ["cargoBay", "ftlDrive", "reactorCore", "specUtility"].includes(e.slotType)).map((e) => pieceCondition(e));
    const average = all.reduce((a, b) => a + b, 0) / all.length;
    expect(average).toBeGreaterThanOrEqual(850);
    expect(average).toBeLessThanOrEqual(950);
  });

  it("an ordinary expedition comes home with its gear 80% or better (its time slices against the upkeep)", () => {
    const ready = afterExpeditionTraining(withAwayTeam(installPiece(seatOfficer(wiringBase(), "operations", []), { slotType: "reactorCore", durabilityMax: 100 })));
    for (let c = 0; c < 3; c++) {
      const res = startExpedition(ready, WIRING_SHIP_ID, 1, expeditionCandidates(ready, WIRING_SHIP_ID)[c].id, true, undefined, false);
      const done = advanceExpedition(res.expedition!, res.expedition!.phaseAnchorSeconds + 1e9);
      const home: GameState = { ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] };
      const events = emptyWearEvents();
      recordExpeditionWear(res.next, home, events);
      const after = resolveGearWear(res.next, home, events);
      for (const e of after.equipment.filter((x) => x.condition !== undefined)) expect(pieceCondition(e), `${e.slotType} on candidate ${c}`).toBeGreaterThanOrEqual(800);
      expect(expeditionWear(done, true)).not.toBeNull();
    }
  });
});
