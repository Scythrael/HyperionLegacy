// WR-4 (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-4): golden hashes
// captured on the code BEFORE any WR-4 engine edit (the CP-0 / FK-3 / G2-0 / SF-0 pattern). Every WR-4 fix keeps
// these green in the same commit, or re-pins one ONLY where its commit names the move and why.
//
//   dispatch  : canDispatch for every mission with Titanium Ore AT its warehouse cap (the two transports included),
//               then every allowed mission dispatched for real and run 300 economyTick seconds.
//   repair    : a damaged destroyer's Shipyard repair with a Damage Control Suite installed: the duration, the
//               started process, the state when the repair completes.
//   patrol    : a Repeat patrol on a destroyer with a seated tactical officer: the dispatch record, the display
//               replay every 150 s, the state after 1,200 s (several relaunches).
//   rungs     : canBuildFacilityUpgrade for every facility at every level, on a poor and on a rich state.
//   utility   : the Damage Control and Pathfinder Suite readers over real minted pieces and synthetic point sums.
//   reach     : the range readout and every mission's dispatch reason for every hull, Fuel Depot at 0 and at its top.
//   lunarMine : the Lunar Mine Contract run 2,000 economyTick seconds (its uncommon tier rolls).
//   expedition: a Ground Ops run with a seated officer, through claim.
//
// Whole-state hashes leave out ONE key, `fuel`: WR-4 retires the vestigial fuel stockpile (OC-C1), and leaving the
// key out of the capture is what lets these pins prove the retirement changes nothing else. Every other field of
// the state is pinned.

import { describe, expect, it, vi } from "vitest";
import Decimal from "break_infinity.js";
// OC-11 (CP-8): the switch that proves the auto-crew pause is the only thing it moved here (see the lunarMine pin).
vi.mock("./crewLock", async (io) => (await import("./complementOc11Switch.fixture")).oc11CrewLockMock(io));
import { withOc11Off } from "./complementOc11Switch.fixture";
import {
  FACILITIES,
  ITEMS,
  MISSIONS,
  SHIP_TYPES,
  freshState,
  type AwayMember,
  type EquipmentInstance,
  type EquipmentRarity,
  type GameState,
  type MissionKey,
  type PatrolMissionState,
  type ShipTypeKey,
} from "./model";
import {
  canBuildFacilityUpgrade,
  canDispatch,
  dispatchCaptainOnMission,
  dispatchCaptainOnPatrol,
  economyTick,
  installMissingCombatBaselines,
  processShipRepairs,
  shipRangeLightYears,
  shipRepairDurationTicks,
  tierCap,
} from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { equippedFor } from "./equipment";
import { officerRepairSpeedBonus } from "./crewOverlay";
import { generateEquipment } from "./itemgen";
import { damageControlEffect, pathfinderEffect, DAMAGE_CONTROL_SUITE_KEY, PATHFINDER_SUITE_KEY } from "./utilityGear";
import { addItemQuality } from "./inventory";
import { advanceExpedition, claimExpedition, expeditionCandidates, startExpedition } from "./expedition";
import { asPreRanksDispatch, asPreSafeFirstRunsDispatch, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { seatOfficer, withFacilityLevel } from "./wiring/probes";
import { withCp2Off } from "./complementCp2Switch.fixture";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const hash = (v: unknown): string => fnv(JSON.stringify(v));
// A whole state, without the retired fuel stockpile (see the header).
// SF-1: nor the run counters (`runCounts`, seeded by freshState, written by a claim and a patrol), absent before SF-1.
const hashState = (s: GameState): string => hash({ ...s, fuel: undefined, runCounts: undefined });

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function seededRng(seed = 0x12345678): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
    return (x >>> 8) / (1 << 24);
  };
}

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const MISSION_KEYS = Object.keys(MISSIONS) as MissionKey[];

function rich(s: GameState): GameState {
  return { ...s, credits: new Decimal(1_000_000) };
}

function levelled(s: GameState, level: number): GameState {
  return { ...s, captains: s.captains.map((c) => ({ ...c, level })) };
}

function onHull(s: GameState, typeKey: ShipTypeKey): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)) };
}

function runTicks(s: GameState, n: number, rng: () => number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}

function mint(varietyKey: string, id: string, iLevel: number, quality: number, rarity: EquipmentRarity, fittedTo: string | null = null): EquipmentInstance {
  const piece = generateEquipment({
    slotType: "specUtility",
    varietyKey,
    blueprintKey: null,
    iLevel,
    quality,
    rarity,
    ascension: "none",
    rng: seededRng(iLevel * 31 + quality),
    allocateId: () => id,
  });
  return { ...piece, fittedToShipId: fittedTo };
}

// A utility piece carrying exactly `points` of one line (the reader sums implicit + rolled lines of its family).
function synthetic(variantKey: string, stat: string, points: number): EquipmentInstance {
  return { slotType: "specUtility", moduleVariant: variantKey, implicitStats: { [stat]: points }, rolledStats: {} } as unknown as EquipmentInstance;
}

// Titanium Ore (commonOre, tier 1) exactly AT its warehouse cap: the ore-cap fixture.
function atOreCap(): GameState {
  const base = levelled(rich(freshState()), 10);
  return { ...base, inventory: addItemQuality(base.inventory, "commonOre", tierCap(base, 1), 0) };
}

// ===== the goldens =====

const GOLDEN: Record<string, string | string[]> = {
  // Re-pinned by WR-4: B2 (OC-I3) lets both transports launch at the ore cap (their gate reads ok and their runs
  // join the list); OC-C2 names the Lunar Mine's uncommon strike Dense Ore (pre-fix 5eb4c97d: naming denseOre back
  // to cobaltOre reproduces it exactly). Every other entry is the pre-fix capture.
  dispatch: [
    "localFuelRun:ok",
    "shortOreRun:materialAtCap",
    "longOreRun:ok",
    "salvageWreckage:ok",
    "forageFlora:ok",
    "surveyMineralAnomaly:materialAtCap",
    "surveyStellarPhenomena:ok",
    "frontierSupplyRun:ok",
    "colonySupplyLift:ok",
    "localFuelRun:c88abeea",
    "longOreRun:692d08c7",
    "salvageWreckage:7946787",
    "forageFlora:dbd99d60",
    "surveyStellarPhenomena:ca585447",
    "frontierSupplyRun:4b3a27f7",
    "colonySupplyLift:fab12771",
  ],
  repair: ["239", "156", "13d55f21", "70d18e4"],
  // Re-pinned by WR-4 (B14): turn order by side, then input order (the player side first); the dispatch record
  // (91429198) is unchanged, every replay and the final state moved. The final state moved again with B4 (the
  // tactical officer's promotion counters: crewHours and shipsDestroyed).
  patrol: ["91429198", "5f21282d", "3402127c", "f524ed0a", "13cbd93d", "50366cbe", "f3e19edd", "1c64af86", "cc2a99b", "4d58a986"],
  rungs: "9928b877",
  utility: [
    "f3df2ef8", "3b01c657", "217dee49", "4f69bf08", "5bdee672", "8074aed9", "e1d54513", "a15fe684",
    "b16f813d", "126b521b", "db034e3c", "94bea692", "91ad5cc1", "1ea09a48", "83b5cc39",
  ],
  // Re-pinned by WR-4 (OC-C1): the Fuel Depot's top level adds its fleet reach bonus (+45%) to every hull's range and
  // reach gate. With the bonus zeroed every pre-fix hash reproduces exactly (the level-0 half never moved).
  reach: [
    "generalFreighter:5ed25c9a",
    "prospectorHauler:93f05878",
    "prospectorRunner:58336ff0",
    "prospectorMiner:51a130d6",
    "destroyer:8f61bd68",
    "battleship:da048827",
    "carrier:3780dcb5",
    "orion:937f2d00",
    "aurora:6238a520",
    "eir:59a618c0",
  ],
  // Re-pinned by WR-4 (OC-C2): Dense Ore for Cobalt Ore; pre-fix e0bbc3d2 (naming denseOre back reproduces it).
  // Re-pinned by CP-2 (WR-4 8e6c6c4c): the passive mission ship takes transport crew mid-run whose Earth-born racials
  // and Crew Effectiveness now lift its other complement buffs; with the CP-2 effects switched off the run
  // reproduces 8e6c6c4c (LUNAR_MINE_CP2_OFF).
  // Re-pinned by OC-11 (CP-8, "Pause while out", CP-2 77bdfad2): the mission ship is out when the transport lands, so
  // its crew wait in the pool; with the pause switched off the run reproduces 77bdfad2 (LUNAR_MINE_OC11_OFF).
  lunarMine: "d1069f5d",
  // Re-pinned by WR-4 (B4, OC-E10): the seated officer's promotion counters (crewHours while out, then the claim's
  // personnelAchievement); the dispatch record and the resolved run are unchanged.
  expedition: ["1fc7c9e6", "1dae182b", "1f818423", "a991930"],
};

// The WR-4 capture of the Lunar Mine run (before CP-2), reproduced with the CP-2 effects switched off.
const LUNAR_MINE_CP2_OFF = "8e6c6c4c";
// The CP-2 pin (before OC-11), reproduced with the OC-11 pause switched off.
const LUNAR_MINE_OC11_OFF = "77bdfad2";

describe("WR-4 pre-fix goldens", () => {
  it("dispatch: every mission's gate at the ore cap, then every allowed mission run 300 s", () => {
    const s0 = atOreCap();
    const reasons = MISSION_KEYS.map((k) => {
      const r = canDispatch(s0, 1, k);
      return `${k}:${r.ok ? "ok" : r.reason}`;
    });
    // The fixture really is at the cap, and holds both transports.
    expect(reasons).toContain("shortOreRun:materialAtCap");
    expect(MISSION_KEYS.filter((k) => MISSIONS[k].missionType === "transport").length).toBe(2);
    const runs = MISSION_KEYS.filter((k) => canDispatch(s0, 1, k).ok).map((k) => {
      const r = dispatchCaptainOnMission(s0, 1, k);
      expect(r.success, k).toBe(true);
      return `${k}:${hashState(runTicks(r.next, 300, lcg(0xd15a)))}`;
    });
    expect([...reasons, ...runs]).toEqual(GOLDEN.dispatch);
  });

  it("repair: a damaged destroyer's Shipyard repair with a Damage Control Suite installed", () => {
    const base = installMissingCombatBaselines(onHull(freshState(), "destroyer"));
    const s0: GameState = {
      ...base,
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 437 } : sh)),
      equipment: [...base.equipment, mint(DAMAGE_CONTROL_SUITE_KEY, "dcs-1", 30, 2, "augmented", "ship-1")],
    };
    const ship = s0.ships[0];
    const ticks = shipRepairDurationTicks(ship, equippedFor(s0, ship.id), officerRepairSpeedBonus(s0, ship));
    const plain = shipRepairDurationTicks(ship, [], 0);
    expect(ticks).toBeLessThan(plain); // the suite really shortens it
    const started = processShipRepairs(s0);
    expect(started.activeProcesses.some((p) => p.kind === "shipRepair")).toBe(true);
    const done = runTicks(started, ticks + 2, lcg(0x5eed));
    expect(done.ships[0].damaged).toBeUndefined();
    expect([String(plain), String(ticks), hash(started.activeProcesses), hashState(done)]).toEqual(GOLDEN.repair);
  });

  it("patrol: a Repeat patrol on a destroyer with a seated tactical officer, relaunched, with the display replay", () => {
    const st = seatOfficer(installMissingCombatBaselines(rich(onHull(freshState(), "destroyer"))), "tactical", ["tac.weaponCommand"], { race: "earthBorn" });
    expect(st.officers.length).toBe(1);
    const r = dispatchCaptainOnPatrol(st, 1, "crimsonReaverSweep", "balanced", true);
    expect(r.success).toBe(true);
    let s = r.next;
    const out = [hash(s.captains[0].mission)];
    let relaunches = 0;
    let prevPhase = (s.captains[0].mission as PatrolMissionState).phase;
    for (let i = 0; i < 1200; i++) {
      s = economyTick(s, 1, () => 0.5);
      const m = s.captains[0].mission as PatrolMissionState | null;
      if (m === null) break;
      if (prevPhase === "transitBack" && m.phase === "transitOut") relaunches += 1;
      prevPhase = m.phase;
      if (i % 150 === 0) out.push(hash(replayPatrol(s, s.captains[0])));
    }
    out.push(hashState(s));
    expect(relaunches).toBeGreaterThan(1);
    expect(out).toEqual(GOLDEN.patrol);
  });

  it("rungs: canBuildFacilityUpgrade for every facility at every level, poor and rich", () => {
    const poor = freshState();
    let inv = poor.inventory;
    for (const id of Object.keys(ITEMS)) inv = addItemQuality(inv, id, new Decimal(1e12), 0);
    const wealthy: GameState = { ...poor, credits: new Decimal(1e15), fleetAdminLevel: 99, inventory: inv };
    const out: string[] = [];
    for (const [key, def] of Object.entries(FACILITIES)) {
      for (let level = 0; level <= def.upgrades.length; level++) {
        const a = canBuildFacilityUpgrade(withFacilityLevel(poor, key, level), key);
        const b = canBuildFacilityUpgrade(withFacilityLevel(wealthy, key, level), key);
        out.push(`${key}:${level}:${a.ok ? "ok" : a.reason}|${b.ok ? "ok" : b.reason}`);
      }
    }
    expect(out.some((l) => l.endsWith("|ok"))).toBe(true);
    expect(hash(out)).toEqual(GOLDEN.rungs);
  });

  it("utility: the Damage Control and Pathfinder Suite readers", () => {
    const out: string[] = [];
    const ladders: [number, number, EquipmentRarity][] = [
      [10, 0, "standard"],
      [25, 2, "augmented"],
      [40, 5, "stellar"],
      [60, 5, "radiant"],
    ];
    for (const [iLevel, quality, rarity] of ladders) {
      out.push(hash(damageControlEffect([mint(DAMAGE_CONTROL_SUITE_KEY, "d", iLevel, quality, rarity)])));
      out.push(hash(pathfinderEffect([mint(PATHFINDER_SUITE_KEY, "p", iLevel, quality, rarity)])));
    }
    for (const points of [0, 1, 12, 50, 110, 500, 5000]) {
      out.push(
        hash([
          damageControlEffect([synthetic(DAMAGE_CONTROL_SUITE_KEY, "repairSpeed", points), synthetic(DAMAGE_CONTROL_SUITE_KEY, "waveHullRegen", points)]),
          pathfinderEffect([synthetic(PATHFINDER_SUITE_KEY, "expeditionScanSpeed", points), synthetic(PATHFINDER_SUITE_KEY, "hazardResist", points)]),
        ]),
      );
    }
    expect(out).toEqual(GOLDEN.utility);
  });

  it("reach: every hull's range readout and dispatch reasons, Fuel Depot at 0 and at its top", () => {
    const top = FACILITIES.fuelStorage.upgrades.length;
    const out = HULLS.map((hull) => {
      const parts = [0, top].map((level) => {
        const s = withFacilityLevel(levelled(rich(onHull(freshState(), hull)), 10), "fuelStorage", level);
        const range = shipRangeLightYears(s, s.ships[0]);
        const gates = MISSION_KEYS.map((k) => {
          const r = canDispatch(s, 1, k);
          return r.ok ? "ok" : r.reason;
        });
        return `${range}:${gates.join(",")}`;
      });
      return `${hull}:${hash(parts)}`;
    });
    expect(out).toEqual(GOLDEN.reach);
  });

  it("lunarMine: the Lunar Mine Contract run 2,000 s", () => {
    const r = dispatchCaptainOnMission(levelled(rich(freshState()), 10), 1, "longOreRun");
    expect(r.success).toBe(true);
    const s = runTicks(r.next, 2000, lcg(0x10a1));
    expect(hashState(s)).toEqual(GOLDEN.lunarMine);
    // OC-11's proof: with the pause switched off the mission ship boards its transport crew mid-run again (the CP-2 pin).
    expect(withOc11Off(() => hashState(runTicks(r.next, 2000, lcg(0x10a1))))).toEqual(LUNAR_MINE_OC11_OFF);
    // CP-2's "turn it off" proof: its switched effects are the only thing it moved here (captured with the ship crewed).
    expect(withOc11Off(() => withCp2Off(() => hashState(runTicks(r.next, 2000, lcg(0x10a1)))))).toEqual(LUNAR_MINE_CP2_OFF);
  });

  it("expedition: a Ground Ops run with a seated officer, through claim", () => {
    const squad: AwayMember[] = [
      { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
      { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
      plainAwayMember("member-11", "science", "ship-1"),
    ];
    const s0 = seatOfficer(withSlottedAwayTeams({ ...freshState(), awayMembers: squad, nextAwayMemberId: 100, expeditionSeed: 0x1234 }), "science", ["sci.discovery"], { race: "earthBorn" });
    // Field Kits FKR-1: the run as dispatched before enemy ranks (the flag off), so it keeps its capture. Safe first
    // runs SF-2: and before SF-2 (the retired 30 minute shakedown on expedition 1).
    const res = asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(s0, "ship-1", 1, expeditionCandidates(s0, "ship-1")[0].id)));
    if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
    expect(res.expedition.groundOps).toBeDefined();
    // The run advanced through the live tick (the officer rides it), then claimed.
    let s = res.next;
    for (let i = 0; i < 40; i++) s = economyTick(s, 1, lcg(0xe4));
    const done = advanceExpedition(s.expeditions[0], 2_000_000);
    expect(done.phase).toBe("complete");
    const claim = claimExpedition({ ...s, expeditions: [done], gameTimeSeconds: 2_000_000 }, done.id);
    expect(claim.success).toBe(true);
    expect([hash(res.expedition), hashState(s), hash(done), hashState(claim.next)]).toEqual(GOLDEN.expedition);
  });
});
