// GEAR WEAR step 4 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 11 step 4): the combat half, through the
// real engine. The wiring registry's sensitivity level proves every battle source and combat consumer at its configured
// magnitude (wiring/wearProbes.ts); gearWearCombatGoldens.test.ts pins the whole combat surface before and after. This
// file proves the rules around them: the true-condition pools (user W3), the frozen cycle view and its replay, the
// stamp (new cycles only; never the training cycle, W9), battle wear below the use floor and never below 0 (W2 + W7),
// offline == live, the expedition and ground sources, the Damage Control Suite, the gates that never read a worn value,
// and no new draw.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, type EquipmentInstance, type GameState, type PatrolMissionState, type ShipTypeKey } from "./model";
import { PATROL_REPAIR_PAUSE_LINE, canDispatchPatrol, recallCaptain, dispatchCaptainOnPatrol, economyTick, processShipRepairs, shipRepairDurationTicks, shipRepairGear } from "./tick";
import { equippedFor } from "./equipment";
import { replayPatrol } from "./combat/patrolReplay";
import { resolveBattle } from "./combat/resolveBattle";
import { defaultSystemDurabilityForHull, shipToCombatant } from "./combat/bridge";
import { makeWeaponInstance } from "./combat/weapons";
import { qualityDurabilityMax } from "./combat/durability";
import {
  CONDITION_FULL,
  USE_WEAR_FLOOR,
  applyBattleWearAt,
  combatGearView,
  combatPieceCondition,
  pieceCondition,
  poolAtCondition,
  toughnessScale,
  wearEfficiency,
  withPieceCondition,
} from "./gearWear";
import { poolBattleWear, waveBattleWear } from "./gearWearCombat";
import { emptyWearEvents, recordExpeditionWear, resolveGearWear } from "./gearWearEngine";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withBattleWearOff } from "./battleWearSwitch.fixture";
import { expeditionCandidates, startExpedition } from "./expedition";
import { resolveShipScanEventFromDraws, shipEventKindOf, SHIP_EVENT_DRAW_UNITS, SHIP_EVENT_WEIGHT_TOTAL } from "./shipScanEvents";
import { DAMAGE_CONTROL_SUITE_KEY } from "./utilityGear";
import { withAwayTeam, WIRING_SHIP_ID } from "./wiring/probes";
import { battleFixture } from "./wiring/wearProbes";
import { runCountsOf } from "./runDifficulty";
import { buildHomeDashboard } from "./homeDashboard";
import { WIRING_REGISTRY } from "./wiring/registry";
import { GW4_CHANGED, GW4_FLIPPED_LIVE } from "./gearWearCombatRegistry.fixture";

const RNG = () => 0.5;

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

const ship1 = (s: GameState): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === "ship-1");
const patrolOf = (s: GameState): PatrolMissionState | null => s.captains[0].mission as PatrolMissionState | null;

function veteran(hull: ShipTypeKey): GameState {
  return asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(1_000_000) });
}

// Every ship-1 piece of `slots` at `condition`, anchored at the clock.
function wornAt(s: GameState, slots: readonly string[], condition: number): GameState {
  return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === "ship-1" && slots.includes(e.slotType) ? withPieceCondition(e, condition, s.gameTimeSeconds) : e)) };
}

function dispatch(s: GameState, repeat = false, key: "crimsonReaverSweep" | "crimsonReaverWarband" = "crimsonReaverSweep"): GameState {
  const r = dispatchCaptainOnPatrol(s, 1, key, "balanced", repeat);
  expect(r.success, r.reason).toBe(true);
  return r.next;
}

describe("gear wear step 4: the frozen combat view (user W3 True condition)", () => {
  it("a view piece reads its frozen condition; a stored piece reads pristine to the step 4 readers (a stored weapon keeps step 2's own-condition rule)", () => {
    const s = wornAt(veteran("destroyer"), ["weapon"], 500);
    const stored = equippedFor(s, "ship-1");
    const weapon = stored.find((p) => p.slotType === "weapon")!;
    expect(pieceCondition(weapon)).toBe(500);
    expect(combatPieceCondition(weapon)).toBe(CONDITION_FULL);
    const view = combatGearView(stored, { [weapon.id]: 500 });
    const viewWeapon = view.find((p) => p.id === weapon.id)!;
    expect(combatPieceCondition(viewWeapon)).toBe(500);
    expect(view.find((p) => p.slotType === "hullPlating")).not.toBe(stored.find((p) => p.slotType === "hullPlating"));
    // A built combatant: the stored gear fights pristine, the view at its true condition.
    const fromStored = shipToCombatant({ id: "p", team: "player", stats: { hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 6 }, installedGear: stored });
    const fromView = shipToCombatant({ id: "p", team: "player", stats: { hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 6 }, installedGear: view });
    expect(fromStored.weapons[0].durability).toBe(poolAtCondition(weapon.durabilityMax, 500));
    expect(fromView.weapons[0].durability).toBe(poolAtCondition(weapon.durabilityMax, 500));
    expect(fromStored.shieldMax).toBe(300);
    // The patrol seed from stored gear is the pre-step-4 full seed; from the view, the true-condition pool.
    expect(defaultSystemDurabilityForHull("destroyer", SHIP_TYPES.destroyer, stored).weapons[0]).toBe(weapon.durabilityMax);
    expect(defaultSystemDurabilityForHull("destroyer", SHIP_TYPES.destroyer, view).weapons[0]).toBe(poolAtCondition(weapon.durabilityMax, 500));
  });

  it("the reactor and the drive open their pools at the installed piece's condition; shields, plating, pods and modules read their efficiency", () => {
    const s = installCrafted(wornAt(veteran("carrier"), ["reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"], 400), "structuralBracing", 400);
    const stored = equippedFor(s, "ship-1");
    const conditions = Object.fromEntries(stored.map((p) => [p.id, pieceCondition(p)]));
    const stats = { hullIntegrity: 1100, shieldCapacity: 500, shieldRecharge: 8 };
    const pristine = shipToCombatant({ id: "p", team: "player", stats, hullType: "carrier", installedGear: stored });
    const worn = shipToCombatant({ id: "p", team: "player", stats, hullType: "carrier", installedGear: combatGearView(stored, conditions) });
    const e = wearEfficiency(400);
    expect(worn.reactor!.durability).toBe(poolAtCondition(qualityDurabilityMax(100, 0), 400));
    expect(worn.ftl!.durability).toBe(poolAtCondition(qualityDurabilityMax(100, 0), 400));
    expect(pristine.reactor!.durability).toBe(pristine.reactor!.durabilityMax);
    expect(worn.shieldMax).toBe(Math.round(pristine.shieldMax * e));
    expect(worn.hullMax).toBeLessThan(pristine.hullMax);
    expect(worn.drones[0].droneHp).toBe(Math.max(1, Math.round(pristine.drones[0].droneHp * e)));
    // No double penalty on the pools (design 4.4): a worn weapon's damage band is untouched, only its pool.
    expect(worn.weapons.map((w) => [w.yieldMin, w.yieldMax])).toEqual(pristine.weapons.map((w) => [w.yieldMin, w.yieldMax]));
  });
});

// A crafted universal module of `variety` installed on ship-1 at `condition`.
function installCrafted(s: GameState, variety: string, condition: number): GameState {
  const piece = {
    id: `gw4-test-${variety}`,
    slotType: "module",
    moduleVariant: variety,
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 20,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: "ship-1",
  } as unknown as EquipmentInstance;
  return { ...s, equipment: [...s.equipment, withPieceCondition(piece, condition, s.gameTimeSeconds)] };
}

describe("gear wear step 4: the stamp (new cycles only)", () => {
  it("a dispatch freezes the ship's worn pieces as the cycle's cycleStartCondition ({} when pristine)", () => {
    expect(patrolOf(dispatch(veteran("destroyer")))!.cycleStartCondition).toEqual({});
    const worn = wornAt(veteran("destroyer"), ["weapon", "reactorCore"], 620);
    const m = patrolOf(dispatch(worn))!;
    const ids = ship1(worn).filter((p) => p.slotType === "weapon" || p.slotType === "reactorCore").map((p) => p.id);
    expect(Object.keys(m.cycleStartCondition!).sort()).toEqual([...ids].sort());
    expect(Object.values(m.cycleStartCondition!).every((c) => c === 620)).toBe(true);
    // The worn weapons open worn (the seed is the true-condition pool).
    expect(m.playerSystemDurability.weapons.every((d) => d === poolAtCondition(100, 620))).toBe(true);
    expect(m.playerSystemDurability.reactor).toBe(poolAtCondition(100, 620));
  });

  it("the training cycle (user W9) and a build with battle wear off are not stamped, and wear nothing", () => {
    const fresh = { ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(1_000_000) };
    const training = dispatch(fresh);
    expect(patrolOf(training)!.difficulty?.firstRun).toBe(true);
    expect(patrolOf(training)!.cycleStartCondition).toBeUndefined();
    const after = stepped(training, 60);
    expect(ship1(after).every((p) => p.condition === undefined)).toBe(true);
    const off = withBattleWearOff(() => dispatch(veteran("destroyer")));
    expect(patrolOf(off)!.cycleStartCondition).toBeUndefined();
  });

  it("in flight: a cycle dispatched before step 4 (inside the switch) flies on byte-identical and wears nothing", () => {
    const worn = wornAt(veteran("carrier"), ["weapon", "reactorCore", "ftlDrive"], 610);
    const inFlight = withBattleWearOff(() => dispatch(worn, false, "crimsonReaverWarband"));
    const live = stepped(inFlight, 80);
    const off = withBattleWearOff(() => stepped(inFlight, 80));
    expect(JSON.stringify(live)).toBe(JSON.stringify(off));
  });
});

describe("gear wear step 4: battle wear (design 3.2; user W2 + W7 Gentle)", () => {
  it("a stamped patrol wears its weapons, reactor, drive, shields and pods, and its replay fights the same frozen gear", () => {
    const s = dispatch(veteran("carrier"), false, "crimsonReaverWarband");
    const replay = replayPatrol(s, s.captains[0]);
    // Read on the tick the patrol ends (the cycle's pools land then; once home the pieces recover at the home rate).
    let end = s;
    while (patrolOf(end) !== null) end = economyTick(end, 1, RNG);
    const worn = ship1(end).filter((p) => p.condition !== undefined).map((p) => p.slotType);
    for (const slot of ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "droneBay"]) expect(worn, slot).toContain(slot);
    expect(replay.waves.length).toBeGreaterThan(0);
  });

  it("the replay of a cycle that opened worn opens the pools the live cycle opened", () => {
    const s = dispatch(wornAt(veteran("destroyer"), ["weapon", "reactorCore", "ftlDrive"], 560));
    const replay = replayPatrol(s, s.captains[0]);
    const m = patrolOf(s)!;
    const start = replay.waves[0].playerStart;
    expect(start.weapons.map((w) => w.durability)).toEqual(m.playerSystemDurability.weapons);
    expect(start.reactor!.durability).toBe(m.playerSystemDurability.reactor);
    expect(start.ftl!.durability).toBe(m.playerSystemDurability.ftl);
  });

  it("battle wear can go below the use floor, scales by toughness, never below 0, and never deletes a piece", () => {
    const piece = { id: "x", slotType: "hullPlating", durabilityMax: 200, implicitStats: {}, rolledStats: {} } as unknown as EquipmentInstance;
    const once = applyBattleWearAt(piece, 900, 10);
    expect(pieceCondition(once)).toBe(CONDITION_FULL - toughnessScale(900, 200));
    expect(pieceCondition(once)).toBeLessThan(USE_WEAR_FLOOR);
    expect(once.conditionAt).toBe(10);
    const twice = applyBattleWearAt(once, 5000, 20);
    expect(pieceCondition(twice)).toBe(0);
    expect(twice.conditionAt).toBe(10); // the anchor carries (the repair fraction is never lost)
    expect(applyBattleWearAt(piece, 0, 10)).toBe(piece);
  });

  it("the readers: a wave's shields, plating and pods, a cycle's pools (raw per-mille over each measure)", () => {
    const gear = [
      { id: "w0", slotType: "weapon" },
      { id: "sh", slotType: "shieldEmitters" },
      { id: "pl", slotType: "hullPlating" },
      { id: "pod", slotType: "droneBay" },
      { id: "re", slotType: "reactorCore" },
      { id: "ft", slotType: "ftlDrive" },
    ] as unknown as EquipmentInstance[];
    const drone = (alive: boolean) => ({ hp: alive ? 10 : 0, hpMax: 10, alive, status: alive ? "online" : "refabricating", repairProgress: 0, refabProgress: 0 });
    const start = { shieldMax: 200, hull: 400, hullMax: 500, drones: [{ drones: [drone(true), drone(true), drone(true), drone(true)] }] };
    const end = { hull: 300, drones: [{ drones: [drone(true), drone(false), drone(false), drone(true)] }] };
    const wave = waveBattleWear(gear, start as never, end as never, 100, true);
    expect(wave).toEqual({ sh: 75, pl: 50, pod: 150 });
    expect(waveBattleWear(gear, start as never, end as never, 100, false)).toEqual({ sh: 75, pod: 150 });
    const pools = poolBattleWear(gear, { weapons: [100], reactor: 90, ftl: 100 }, { weapons: [100], reactor: 100, ftl: 100 }, { weapons: [96], reactor: 81, ftl: 100 });
    expect(pools).toEqual({ w0: 40, re: 90 });
  });
});

describe("gear wear step 4: offline == live (one call == chunks == 1 s steps)", () => {
  it("a Repeat patrol with worn gear: one call, 7 s chunks and 1 s steps leave the same state", () => {
    const s = dispatch(wornAt(veteran("battleship"), ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating"], 700), true);
    const n = 70;
    const one = economyTick(s, n, RNG);
    let chunks = s;
    for (let i = 0; i < n / 7; i++) chunks = economyTick(chunks, 7, RNG);
    const steps = stepped(s, n);
    expect(JSON.stringify(steps.equipment)).toBe(JSON.stringify(one.equipment));
    expect(JSON.stringify(chunks.equipment)).toBe(JSON.stringify(one.equipment));
    expect(JSON.stringify(steps.captains)).toBe(JSON.stringify(one.captains));
    expect(JSON.stringify(chunks.captains)).toBe(JSON.stringify(one.captains));
  });

  it("no new draw: the shield tally changes nothing about the battle", () => {
    const player = shipToCombatant({ id: "p", team: "player", stats: { hullIntegrity: 600, shieldCapacity: 300, shieldRecharge: 6 }, hullType: "destroyer" });
    const enemy = shipToCombatant({ id: "e", team: "enemy", stats: { hullIntegrity: 400, shieldCapacity: 100, shieldRecharge: 2 }, weaponLoadout: [makeWeaponInstance("autocannon", "e-w0")] });
    const plain = resolveBattle({ combatants: [player, enemy] }, 1234, { precharge: true });
    const tallied = resolveBattle({ combatants: [player, enemy] }, 1234, { precharge: true, shieldTallyFor: "p" });
    expect(JSON.stringify(tallied.finalCombatants)).toBe(JSON.stringify(plain.finalCombatants));
    expect(tallied.outcome).toEqual(plain.outcome);
    expect(tallied.shieldAbsorbed).toBeGreaterThan(0);
    expect(plain.shieldAbsorbed).toBeUndefined();
  });
});

describe("gear wear step 4: the expedition and ground sources", () => {
  it("a battle-stamped run's ship battle records its wear on the event; its hull wear wears the plating; it lands as the run comes home", () => {
    const c = runCountsOf(battleFixture());
    const ready = { ...withAwayTeam(battleFixture()), runCounts: { ...c, expedition: { ...c.expedition, trainingDone: true, veteran: true } } };
    const res = startExpedition(ready, WIRING_SHIP_ID, 1, expeditionCandidates(ready, WIRING_SHIP_ID)[0].id, true, undefined, false);
    expect(res.success).toBe(true);
    const exp = res.expedition!;
    expect(exp.gearWear?.battle).toBe(1);
    expect(exp.groundOps?.shipEventProfile?.battle?.gearWear).toBe(1);
    let kind = 0;
    while (kind < SHIP_EVENT_WEIGHT_TOTAL && shipEventKindOf({ kind, cloaked: 0 }) !== "probe") kind += 1;
    const probe = resolveShipScanEventFromDraws(exp, exp.bodies[0], 0, 0, 1, { kind, check: 0, cloaked: 0, boardingAttempt: SHIP_EVENT_DRAW_UNITS - 1, boardingRepel: 0 });
    expect(Object.keys(probe.event.gearWear ?? {}).length).toBeGreaterThan(0);
    const home = res.next.gameTimeSeconds + 1;
    const done = { ...exp, phase: "complete" as const, phaseAnchorSeconds: home, scanEvents: [probe.event] };
    const before = { ...res.next, gameTimeSeconds: home - 1 };
    const finished = { ...res.next, gameTimeSeconds: home, expeditions: res.next.expeditions.map((e) => (e.id === exp.id ? done : e)) };
    const events = emptyWearEvents();
    recordExpeditionWear(before, finished, events);
    const after = resolveGearWear(before, finished, events);
    for (const id of Object.keys(probe.event.gearWear!)) expect(pieceCondition(after.equipment.find((p) => p.id === id)!), id).toBeLessThan(CONDITION_FULL);
  });
});

describe("gear wear step 4: the Damage Control Suite (its fires and its lines)", () => {
  function withSuite(s: GameState, condition?: number): GameState {
    const suite = {
      id: "gw4-dc",
      slotType: "specUtility",
      moduleVariant: DAMAGE_CONTROL_SUITE_KEY,
      rarity: "standard",
      ascension: "none",
      quality: 0,
      iLevel: 20,
      blueprintKey: null,
      implicitStats: { repairSpeed: 40, waveHullRegen: 40 },
      rolledStats: {},
      mass: 0,
      powerDraw: 0,
      durabilityMax: 100,
      fittedToShipId: "ship-1",
    } as unknown as EquipmentInstance;
    const kept = s.equipment.filter((e) => !(e.fittedToShipId === "ship-1" && e.slotType === "specUtility"));
    return { ...s, equipment: [...kept, condition === undefined ? suite : withPieceCondition(suite, condition, s.gameTimeSeconds)] };
  }

  it("a Shipyard repair it shortens is one fire (use wear on the suite) and a worn suite shortens it less", () => {
    const damaged = (s: GameState) => ({ ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 600 } : sh)) });
    const s = damaged(withSuite(veteran("destroyer")));
    const after = economyTick(s, 1, RNG);
    expect(after.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    expect(pieceCondition(after.equipment.find((p) => p.id === "gw4-dc")!)).toBeLessThan(CONDITION_FULL);
    const worn = damaged(withSuite(veteran("destroyer"), 300));
    const ship = worn.ships[0];
    expect(shipRepairDurationTicks(ship, shipRepairGear(worn, "ship-1"))).toBeGreaterThan(shipRepairDurationTicks(ship, shipRepairGear(s, "ship-1")));
    // The stored gear (no wear) is what the repair read before step 4.
    expect(shipRepairGear(s, "ship-1")).toEqual(equippedFor(s, "ship-1"));
    expect(processShipRepairs(s).activeProcesses.length).toBe(1);
  });

  it("a patrol wave it patches is one fire", () => {
    const s = dispatch(withSuite(veteran("generalFreighter")), false, "crimsonReaverWarband");
    const replay = replayPatrol(s, s.captains[0]);
    const wave = replay.waves.findIndex((w, i) => i > 0 && w.playerStart.hull > (replay.waves[i - 1].playerEnd?.hull ?? Infinity));
    expect(wave).toBeGreaterThan(0);
    const before = stepped(s, replay.waves[wave].routeTick - 1);
    expect(pieceCondition(before.equipment.find((p) => p.id === "gw4-dc")!)).toBe(CONDITION_FULL);
    const at = economyTick(before, 1, RNG);
    expect(pieceCondition(at.equipment.find((p) => p.id === "gw4-dc")!)).toBeLessThan(CONDITION_FULL);
  });
});

describe("gear wear step 4: the registry (every row step 4 owned is live with a probe; gearWearCombatRegistry.fixture.ts reads the move back)", () => {
  it("the battle sources, the combat consumers, the suite's fires and lines and the toughness rows", () => {
    const rows = WIRING_REGISTRY.filter((e) => GW4_FLIPPED_LIVE.has(e.id) || GW4_CHANGED.has(e.id));
    expect(rows.length).toBe(GW4_FLIPPED_LIVE.size + GW4_CHANGED.size);
    for (const e of rows) {
      if (e.id === "wear:WEAR_EFFICIENCY:reactorCore:powerOutput") {
        expect(e.status.kind, e.id).toBe("pending");
        continue;
      }
      expect(e.status.kind, e.id).toBe("live");
      expect(e.probe, e.id).toBeDefined();
      expect(e.contexts.length, e.id).toBeGreaterThan(0);
    }
    expect(WIRING_REGISTRY.find((e) => e.id === "wear:WEAR_SOURCES:specUtility:effectFires")!.contexts).toEqual(expect.arrayContaining(["shipyard", "patrol"]));
  });
});

describe("gear wear step 4: never a gate (design 4.3: no gate reads a worn value)", () => {
  it("the patrol dispatch gate reads the same at any condition", () => {
    const base = veteran("destroyer");
    const worn = wornAt(base, ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "cargoBay"], 0);
    for (const key of ["crimsonReaverSweep", "crimsonReaverWarband"] as const) {
      expect(canDispatchPatrol(worn, 1, key)).toEqual(canDispatchPatrol(base, 1, key));
    }
  });
});

describe("gear wear step 4: pause to repair (user 2026-10-27): a Repeat patrol goes home to repair, then resumes", () => {
  // A Repeat Sweep flown for `cycles` relaunches in 1 s steps. Never a defeat.
  function longRepeat(hull: ShipTypeKey, cycles: number): { pauses: number; relaunches: number; s: GameState } {
    let s = dispatch(veteran(hull), true);
    let relaunches = 0;
    let seed = patrolOf(s)!.masterSeed;
    let pauses = 0;
    let wasPaused = false;
    for (let t = 0; t < 400_000 && relaunches < cycles; t++) {
      s = economyTick(s, 1, RNG);
      const m = patrolOf(s);
      expect(m, `${hull}: the patrol never ends (no defeat) by relaunch ${relaunches}`).not.toBeNull();
      if (m!.repairPause && !wasPaused) pauses += 1;
      wasPaused = m!.repairPause !== undefined;
      if (m!.masterSeed !== seed) {
        seed = m!.masterSeed;
        relaunches += 1;
        // Every cycle opens with its combat pieces at or above the line.
        for (const c of Object.values(m!.cycleStartCondition ?? {})) expect(c).toBeGreaterThanOrEqual(PATROL_REPAIR_PAUSE_LINE);
      }
    }
    return { pauses, relaunches, s };
  }

  for (const hull of ["destroyer", "battleship"] as const) {
    it(`a ${hull}'s Repeat Sweep (it lost to wear before the pause) flies 200 cycles, pausing and resuming, never defeated`, () => {
      const r = longRepeat(hull, 200);
      expect(r.relaunches).toBe(200);
      expect(r.pauses).toBeGreaterThan(0);
      expect((patrolOf(r.s)!.repairPausesThisRun ?? 0)).toBe(r.pauses);
      expect(r.s.ships[0].damaged).not.toBe(true);
    }, 600_000);
  }

  it("offline == live across a pause: one call == 97 s chunks == 1 s steps", () => {
    const s = dispatch(wornAt(veteran("destroyer"), ["weapon", "reactorCore", "shieldEmitters"], 720), true);
    const n = 970;
    const one = economyTick(s, n, RNG);
    let chunks = s;
    for (let i = 0; i < 10; i++) chunks = economyTick(chunks, 97, RNG);
    const steps = stepped(s, n);
    expect(patrolOf(steps)!.repairPausesThisRun ?? 0).toBeGreaterThan(0);
    for (const [name, x] of [["one", one], ["chunks", chunks]] as const) {
      expect(JSON.stringify(x.equipment), name).toBe(JSON.stringify(steps.equipment));
      expect(JSON.stringify(x.captains), name).toBe(JSON.stringify(steps.captains));
    }
  });

  it("an in-flight (unstamped) Repeat cycle never pauses", () => {
    const s = withBattleWearOff(() => dispatch(wornAt(veteran("destroyer"), ["weapon"], 300), true));
    const after = stepped(s, 15);
    expect(patrolOf(after)!.repairPause).toBeUndefined();
  });
});

describe("gear wear step 4 review (2026-10-27): repair first, count on the run, recall, time skip, the line", () => {
  const COMBAT = ["weapon", "reactorCore", "ftlDrive", "shieldEmitters", "hullPlating", "droneBay"];

  it("Repair first, then go: a Repeat dispatch under the line starts paused (never blocked), then flies its first cycle repaired", () => {
    const worn = wornAt(veteran("destroyer"), COMBAT, 550);
    const s = dispatch(worn, true);
    const m = patrolOf(s)!;
    expect(m.repairPause?.first).toBe(true);
    expect(m.repairPausesThisRun).toBe(1);
    let st = s;
    while (patrolOf(st)!.repairPause !== undefined) st = economyTick(st, 1, RNG);
    const first = patrolOf(st)!;
    for (const c of Object.values(first.cycleStartCondition ?? {})) expect(c).toBeGreaterThanOrEqual(PATROL_REPAIR_PAUSE_LINE);
    // A Dispatch Once with the same gear is never paused (only Repeat repairs first).
    expect(patrolOf(dispatch(worn, false))!.repairPause).toBeUndefined();
  });

  it("Count on the run: a recall during a pause ends the run at once, one log entry saying how many pauses", () => {
    const s = dispatch(wornAt(veteran("destroyer"), COMBAT, 550), true);
    const r = recallCaptain(s, 1, 1234);
    expect(r.success).toBe(true);
    expect(r.next.captains[0].mission).toBeNull();
    const entry = r.next.completionLog!.at(-1)!;
    expect([entry.kind, entry.patrolEndReason, entry.repairPauses]).toEqual(["patrolRun", "recalled", 1]);
    expect(buildHomeDashboard(r.next).recentlyCompleted[0].secondaryLabel).toContain("paused to repair once");
  });

  it("the Home row says repairing while paused", () => {
    const s = dispatch(wornAt(veteran("destroyer"), COMBAT, 550), true);
    const row = buildHomeDashboard(s).inProgress.find((x) => x.kind === "patrol")!;
    expect(row.secondaryLabel).toBe("Repairing gear at home");
  });

  it("a time skip stops at a pause: the pause takes its real time and repairs", () => {
    const s = dispatch(wornAt(veteran("destroyer"), COMBAT, 550), true);
    const m = patrolOf(s)!;
    const skipped: GameState = { ...s, captains: s.captains.map((c, i) => (i === 0 ? { ...c, mission: { ...m, speed: { instantComplete: true } } as PatrolMissionState } : c)) };
    const after = economyTick(skipped, 1, RNG);
    const left = patrolOf(after)!;
    expect(left.speed).toBeUndefined();
    expect(left.repairPause?.ticksRemaining).toBe(m.repairPause!.ticksRemaining - 1);
  });

  // The line, measured (review 2026-10-27): every hull and route, a first cycle with every combat piece AT the line
  // against its pristine twin, 8 seeds each. Wear only ever hurts (the worn ship never wins a fight its twin loses),
  // and at the line it loses WEAR_LINE_FLIPS of the fights its twin wins: the line is the user's call (a Repeat run
  // pauses below it; strict "no fight lost to wear" needs a line of 1000, a repair before every cycle).
  const WEAR_LINE_FLIPS = 20; // of 160 fights (8 seeds x 10 hulls x 2 routes)
  it("every hull and route at the line against pristine: wear only hurts, and its flips are pinned", () => {
    let flips = 0;
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      for (const key of ["crimsonReaverSweep", "crimsonReaverWarband"] as const) {
        for (let seed = 1; seed <= 8; seed++) {
          const outcome = (s: GameState) => {
            let st = dispatch({ ...s, nextPatrolSeed: seed }, false, key);
            for (let t = 0; t < 400 && patrolOf(st) !== null; t++) st = economyTick(st, 1, RNG);
            return st.ships[0].damaged === true ? "lost" : "won";
          };
          const pristine = outcome(veteran(hull));
          const atLine = outcome(wornAt(veteran(hull), COMBAT, PATROL_REPAIR_PAUSE_LINE));
          if (pristine === "lost") expect(atLine, `${hull} ${key} seed ${seed}`).toBe("lost");
          if (pristine === "won" && atLine === "lost") flips += 1;
        }
      }
    }
    expect(flips).toBe(WEAR_LINE_FLIPS);
  }, 600_000);
});
