// ============================================================================
// homeDashboard.test.ts : Home mission-control dashboard, Unit 1 (in-progress list)
//
// Locks the GENERIC in-progress enumeration of buildHomeDashboard: one synthetic
// state carrying one TimedProcess of EVERY TimedProcessKind, plus a patrol captain,
// an extraction captain, and an idle captain. Asserts the resulting inProgress rows
// (label, progress fraction, jump target, the raw remaining/duration ticks, and that
// hull/shield combat detail appears ONLY on a patrol row), and that an idle captain
// contributes NO row. needsOrders / locked / allCaughtUp are Unit 1 stubs and are
// asserted empty/false here so a later unit filling them trips this guard on purpose.
//
// The state is built BY HAND (not via the dispatch/start actions) so the test targets
// the pure derivation directly and stays deterministic: each process effect + mission
// arm is a literal, and the label lookups resolve against the real launch tables.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  freshCaptainStack,
  type GameState,
  type CaptainState,
  type TimedProcess,
  type CaptainMissionState,
  type PatrolMissionState,
  type LootMaterialKey,
} from "./model";
import { buildHomeDashboard, type ActivityRow } from "./homeDashboard";

// One TimedProcess of every kind, each with a valid effect whose noun resolves against
// the real launch tables (so the label assertions below track any content rename). The
// refineJob carries the values the progress/ETA assertions read (100 total, 60 left ->
// 0.4 elapsed); the rest use round numbers since only their label + jump target matter.
function oneOfEveryProcess(): TimedProcess[] {
  return [
    {
      id: "p-refine",
      kind: "refineJob",
      remainingTicks: 60,
      durationTicks: 100,
      effect: { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(10) },
    },
    {
      id: "p-facility",
      kind: "facilityUpgrade",
      remainingTicks: 10,
      durationTicks: 20,
      effect: { type: "facilityLevelUp", facility: "refinery" },
    },
    {
      id: "p-fuel",
      kind: "fuelRefineJob",
      remainingTicks: 5,
      durationTicks: 10,
      effect: { type: "addFuel", amount: new Decimal(50) },
    },
    {
      id: "p-research",
      kind: "researchProject",
      remainingTicks: 40,
      durationTicks: 80,
      effect: { type: "unlockBlueprint", key: "frameSegmentBp" },
    },
    {
      id: "p-fabricate",
      kind: "fabricateJob",
      remainingTicks: 30,
      durationTicks: 60,
      effect: { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) },
    },
    {
      id: "p-shipbuild",
      kind: "shipBuild",
      remainingTicks: 100,
      durationTicks: 200,
      effect: { type: "addShip", typeKey: "prospectorMiner" },
    },
    {
      id: "p-equipstorage",
      kind: "equipmentStorageUpgrade",
      remainingTicks: 15,
      durationTicks: 30,
      effect: { type: "equipmentStorageLevelUp" },
    },
    {
      id: "p-docks",
      kind: "docksExpansion",
      remainingTicks: 25,
      durationTicks: 50,
      effect: { type: "docksCapacityUp" },
    },
    {
      id: "p-repair",
      kind: "shipRepair",
      remainingTicks: 12,
      durationTicks: 24,
      effect: { type: "clearShipDamage", shipId: "ship-1" },
    },
  ];
}

// A captain flying a patrol. Half-hull / half-shield of the assigned ship-1
// (generalFreighter: hull 500, shield 200), 1 of 3 waves resolved, phase "engaging".
function patrolCaptain(): CaptainState {
  const mission: PatrolMissionState = {
    kind: "patrol",
    patrolKey: "crimsonReaverSweep",
    factionId: "crimsonReavers",
    stance: "balanced",
    masterSeed: 1,
    phase: "engaging",
    progressTicks: 15,
    waveTicks: [10, 20, 30],
    nextWaveIndex: 1,
    wavesWon: 1,
    wavesLost: 0,
    playerHull: 250,
    playerShield: 100,
    playerDrones: [],
    playerSystemDurability: { weapons: [], reactor: 0, ftl: 0 },
    recalled: false,
    repeatDispatch: false,
  };
  return { ...freshCaptainStack(), id: 1, label: "Alpha", mission };
}

// A captain on an extraction mission. Phase "transitOut" (Local Asteroid = shortOreRun,
// transitOutTicks 25), 5 of those 25 ticks elapsed -> progress 0.2, remaining 20.
function extractionCaptain(): CaptainState {
  const emptyCargo: Record<LootMaterialKey, Decimal> = {
    commonOre: new Decimal(0),
    uncommonMaterial: new Decimal(0),
    rareMaterial: new Decimal(0),
  };
  const mission: CaptainMissionState = {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "transitOut",
    phaseProgressTicks: 5,
    cargo: emptyCargo,
    recalled: false,
  };
  return { ...freshCaptainStack(), id: 2, label: "Bravo", mission };
}

// An idle captain (no mission) : must contribute NO in-progress row.
function idleCaptain(): CaptainState {
  return { ...freshCaptainStack(), id: 3, label: "Charlie", mission: null };
}

// A synthetic state: ship-1 (generalFreighter) assigned to the patrol captain (id 1),
// all nine processes running, three captains (patrol / extraction / idle).
function seededState(): GameState {
  const base = freshState();
  return {
    ...base,
    activeProcesses: oneOfEveryProcess(),
    captains: [patrolCaptain(), extractionCaptain(), idleCaptain()],
    ships: [{ id: "ship-1", typeKey: "generalFreighter", assignedCaptainId: 1 }],
  };
}

// Small locator so each assertion reads by row id, not array index.
function rowById(rows: ActivityRow[], id: string): ActivityRow {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`expected an inProgress row with id "${id}"`);
  return row;
}

describe("buildHomeDashboard, in-progress list (Unit 1)", () => {
  const model = buildHomeDashboard(seededState());
  const rows = model.inProgress;

  it("emits one row per running process plus one per active mission, and none for the idle captain", () => {
    // 9 processes + patrol + extraction = 11; the idle captain (id 3) adds nothing.
    expect(rows.length).toBe(11);
    expect(rows.some((r) => r.id.includes("3"))).toBe(false);
  });

  it("labels + routes each TimedProcessKind from its effect", () => {
    const refine = rowById(rows, "p-refine");
    expect(refine.primaryLabel).toBe("Refining, Titanium Ingot");
    expect(refine.jumpTarget).toBe("refinery");
    expect(refine.kind).toBe("timed-job");

    expect(rowById(rows, "p-facility").primaryLabel).toBe("Refinery, upgrade to Level 1");
    expect(rowById(rows, "p-facility").jumpTarget).toBe("refinery");

    expect(rowById(rows, "p-fuel").primaryLabel).toBe("Fuel Depot, topping up");
    expect(rowById(rows, "p-fuel").jumpTarget).toBe("fuelDepot");

    expect(rowById(rows, "p-research").primaryLabel).toBe("Researching, Frame Segment Blueprint");
    expect(rowById(rows, "p-research").jumpTarget).toBe("research");

    expect(rowById(rows, "p-fabricate").primaryLabel).toBe("Fabricating, Titanium Ingot");
    expect(rowById(rows, "p-fabricate").jumpTarget).toBe("fabricator");

    expect(rowById(rows, "p-shipbuild").primaryLabel).toBe("Building, Prospector");
    expect(rowById(rows, "p-shipbuild").jumpTarget).toBe("shipyard");

    // Ship Systems storage has no Section-8 tab -> a non-navigable status row.
    expect(rowById(rows, "p-equipstorage").primaryLabel).toBe("Ship Systems storage, upgrade to Level 1");
    expect(rowById(rows, "p-equipstorage").jumpTarget).toBeNull();

    expect(rowById(rows, "p-docks").primaryLabel).toBe("Docks, expand capacity");
    expect(rowById(rows, "p-docks").jumpTarget).toBe("shipyard");

    // Ship repair names the target ship (ship-1 = General Freighter) and routes to the Shipyard.
    expect(rowById(rows, "p-repair").primaryLabel).toBe("Repairing, General Freighter hull");
    expect(rowById(rows, "p-repair").jumpTarget).toBe("shipyard");
  });

  it("computes a timed job's progress fraction and carries the raw ticks for the ETA", () => {
    const refine = rowById(rows, "p-refine");
    // (durationTicks - remainingTicks) / durationTicks = (100 - 60) / 100.
    expect(refine.progress).toBeCloseTo(0.4, 10);
    expect(refine.remainingTicks).toBe(60);
    expect(refine.durationTicks).toBe(100);
  });

  it("renders an extraction mission as a per-phase row routed to gathering", () => {
    const extraction = rowById(rows, "extraction-2");
    expect(extraction.kind).toBe("extraction");
    expect(extraction.primaryLabel).toBe("Bravo, Local Asteroid");
    expect(extraction.secondaryLabel).toBe("Transiting Out");
    expect(extraction.jumpTarget).toBe("gathering");
    // 5 of 25 phase ticks -> progress 0.2, remaining 20, duration 25.
    expect(extraction.progress).toBeCloseTo(0.2, 10);
    expect(extraction.remainingTicks).toBe(20);
    expect(extraction.durationTicks).toBe(25);
    expect(extraction.combat).toBeNull();
  });

  it("renders a patrol as a wave-based row with hull/shield detail and NO whole-clock ETA", () => {
    const patrol = rowById(rows, "patrol-1");
    expect(patrol.kind).toBe("patrol");
    expect(patrol.primaryLabel).toBe("Alpha vs The Crimson Reavers");
    expect(patrol.secondaryLabel).toBe("Engaging");
    expect(patrol.jumpTarget).toBe("combat");
    // Missions have no honest countdown -> ticks are null; progress is wave-based (1 of 3).
    expect(patrol.remainingTicks).toBeNull();
    expect(patrol.durationTicks).toBeNull();
    expect(patrol.progress).toBeCloseTo(1 / 3, 10);
    // Combat detail: half hull (250/500), half shield (100/200), 1 of 3 waves, phase raw.
    expect(patrol.combat).not.toBeNull();
    expect(patrol.combat!.hullFraction).toBeCloseTo(0.5, 10);
    expect(patrol.combat!.shieldFraction).toBeCloseTo(0.5, 10);
    expect(patrol.combat!.wavesResolved).toBe(1);
    expect(patrol.combat!.totalWaves).toBe(3);
    expect(patrol.combat!.phase).toBe("engaging");
  });

  it("attaches combat detail ONLY to patrol rows", () => {
    for (const row of rows) {
      if (row.kind === "patrol") {
        expect(row.combat).not.toBeNull();
      } else {
        expect(row.combat).toBeNull();
      }
    }
  });

  it("leaves needsOrders / locked / allCaughtUp as Unit 1 stubs", () => {
    expect(model.needsOrders).toEqual([]);
    expect(model.locked).toEqual([]);
    expect(model.allCaughtUp).toBe(false);
  });
});
