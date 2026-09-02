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
  BLUEPRINTS,
  SHIP_TYPES,
  type GameState,
  type CaptainState,
  type TimedProcess,
  type CaptainMissionState,
  type PatrolMissionState,
  type LootMaterialKey,
  // 0.13.3 Unit 4.4b: the stored completed-events record the RECENTLY COMPLETED cases at
  // the bottom of this file build fixtures from, plus the item registry those records are
  // resolved against (ids in, labels + rarities out).
  ITEMS,
  type CompletionLogEntry,
} from "./model";
import { buildHomeDashboard, HOME_RECENT_COMPLETIONS_LIMIT, type ActivityRow } from "./homeDashboard";

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

  it("reports this all-busy state as caught up (Unit 2), and now fills locked (Unit 3)", () => {
    // Unit 2 now computes needsOrders / allCaughtUp (they were Unit 1 stubs). For THIS
    // seeded state nothing is actionable: captains 1 + 2 are on missions (busy), the one
    // idle captain (Charlie, id 3) has no assigned hull (noShip), the sole research slot is
    // busy (p-research), the refinery + shipyard are level 0 (unbuilt/unfounded), and the
    // fabricator has nothing researched to craft. So there are no prompts and the board is
    // caught up.
    expect(model.needsOrders).toEqual([]);
    expect(model.allCaughtUp).toBe(true);
    // Unit 3 now fills locked (it was a Unit 1/2 stub). This state is freshState-based, so
    // locked carries the four reserved coming-soon features PLUS the level-0 facilities; it
    // is no longer empty. The exact contents are locked down in the Unit 3 block below; here
    // we only prove the stub is gone and a known coming-soon slot is present.
    expect(model.locked.length).toBeGreaterThan(0);
    expect(model.locked.some((s) => s.id === "locked-crewEquipment")).toBe(true);
  });
});

// ============================================================================
// Unit 2: NEEDS YOUR ORDERS (idle + actionable) + allCaughtUp
//
// Locks the idle-and-actionable detection: a slot surfaces a prompt ONLY when the game's
// own START gate says it can start something there right now, and idle-but-nothing-available
// surfaces NOTHING. States are built BY HAND from freshState() (credits 0, fuel full,
// refinery/shipyard level 0, research/fabricator level 1, captain 1 idle with a General
// Freighter) and mutated to force one exact condition each, so every gate outcome is
// deterministic. Prompts are located by id (never array index) so ordering changes don't
// break these.
// ============================================================================

// Locate a prompt by id (undefined = the slot produced no prompt, the whole point of several
// cases below), so each assertion reads by id, not position.
function promptById(model: ReturnType<typeof buildHomeDashboard>, id: string) {
  return model.needsOrders.find((p) => p.id === id);
}

describe("buildHomeDashboard, needs-orders + caught-up (Unit 2)", () => {
  it("surfaces the captain-dispatch prompt for a fresh admiral (idle captain + full tank), not caught up", () => {
    // freshState: captain 1 is idle, flies the seeded General Freighter, and the tank is
    // full, so a gathering mission is dispatchable. That one actionable slot must produce
    // the aggregate captain prompt routed to gathering, and the board is NOT caught up.
    const model = buildHomeDashboard(freshState());
    const captain = promptById(model, "idle-captain");
    expect(captain).toBeDefined();
    expect(captain!.jumpTarget).toBe("gathering");
    expect(model.allCaughtUp).toBe(false);
  });

  it("produces NO prompt anywhere and reports caught up when nothing is actionable", () => {
    // A genuinely nothing-actionable fleet, modeled on a REACHABLE save (credits 0, nothing
    // researched, no captains). Facility levels use freshState's REAL seed: the pre-granted
    // Research Lab / Fabricator / Mission Control sit at level 1 (never level 0 in real play),
    // while the Refinery / Shipyard / Warehouse / Fuel Depot sit at level 0. WHY the real seed
    // and not an all-level-0 map: a level-0 pre-granted facility would expose its ZERO-COST,
    // ungated FOUNDING rung, which canBuildFacilityUpgrade correctly reports as startable, so
    // the new aggregate facility-upgrade prompt would fire on an unreachable configuration.
    // With the real seed every gate is blocked:
    //   - no captains          -> no dispatch prompt,
    //   - Research: free slot but 0 credits (every blueprint costs >= 500) -> canResearch "credits",
    //   - Fabricator: free slot but nothing researched (researchedBlueprints []) -> canStartLine not ok,
    //   - Refinery: level 0 -> refineSlotCount 0 -> canStartLine "refine" noSlot,
    //   - Shipyard: level 0 -> canBuildShip notFounded,
    //   - Facility upgrades: Mission Control maxed (lone rung), Research/Fabricator 1->2 want
    //     5000 credits + FA level, Refinery founding wants 100 ore, Shipyard founding wants 2000
    //     credits + FA level, Warehouse/Fuel foundings want huge ore -> canBuildFacilityUpgrade
    //     ok for none.
    // So no slot is actionable: zero prompts, allCaughtUp true. (Note the Local Asteroid run
    // costs zero fuel by design, so a captain WITH a hull is always dispatchable; this state
    // removes the captains to reach a true nothing-actionable board rather than stranding one,
    // which the anti-softlock run forbids.)
    const blank = {
      ...freshState(),
      captains: [],
      facilities: {
        refinery: { level: 0 },
        warehouseT1: { level: 0 },
        warehouseT2: { level: 0 },
        fuelStorage: { level: 0 },
        missionControl: { level: 1 },
        research: { level: 1 },
        fabricator: { level: 1 },
        shipyard: { level: 0 },
      },
    };
    const model = buildHomeDashboard(blank);
    expect(model.needsOrders).toEqual([]);
    expect(model.allCaughtUp).toBe(true);
  });

  it("surfaces the research prompt when a free research slot has an affordable blueprint", () => {
    // Fresh research lab (level 1, one free slot, nothing researched) + credits to spare:
    // at least one tier-1 blueprint becomes researchable-and-affordable, so canResearch ok
    // for it and the research prompt appears, routed to research.
    const flush = { ...freshState(), credits: new Decimal(1e12) };
    const model = buildHomeDashboard(flush);
    const research = promptById(model, "idle-research");
    expect(research).toBeDefined();
    expect(research!.jumpTarget).toBe("research");
    expect(model.allCaughtUp).toBe(false);
  });

  it("produces NO research prompt when every blueprint is already researched (nothing available)", () => {
    // A free research slot + ample credits, but EVERY blueprint is already researched, so
    // canResearch returns alreadyResearched for all of them. The idle slot has nothing to
    // start, so it must NOT dead-end on an empty picker: no research prompt.
    const allResearched = {
      ...freshState(),
      credits: new Decimal(1e12),
      researchedBlueprints: Object.keys(BLUEPRINTS),
    };
    const model = buildHomeDashboard(allResearched);
    expect(promptById(model, "idle-research")).toBeUndefined();
  });

  it("surfaces the shipyard prompt only while a dock is free, and drops it when docks are full", () => {
    // A founded shipyard (level 1), a General Freighter's full BOM in stock, and ample
    // credits: with a free dock (1 ship < capacity 8) canBuildShip ok, so the shipyard
    // prompt appears. Filling the docks (capacity == ships.length) must make it disappear,
    // proving the docks-full case surfaces NO prompt (canBuildShip's storageFull gate).
    const freighterBom = SHIP_TYPES.generalFreighter.buildRecipe.components; // { frameSegment, powerCoupling }
    const base = freshState();
    const buildable = {
      ...base,
      credits: new Decimal(1e12),
      facilities: { ...base.facilities, shipyard: { level: 1 } },
      inventory: {
        ...base.inventory,
        frameSegment: [new Decimal(freighterBom.frameSegment + 10)],
        powerCoupling: [new Decimal(freighterBom.powerCoupling + 10)],
      },
      shipStorageCapacity: 8, // one seeded ship, plenty of free docks
    };
    expect(promptById(buildHomeDashboard(buildable), "idle-shipyard")).toBeDefined();

    // Same state, but the docks are full (capacity == the one seeded ship): no prompt.
    const docksFull = { ...buildable, shipStorageCapacity: buildable.ships.length };
    expect(promptById(buildHomeDashboard(docksFull), "idle-shipyard")).toBeUndefined();
  });

  it("names the specific facility and carries its key when exactly one upgrade is startable", () => {
    // freshState seeds credits 0 + Fleet Admiral level 1, so NO facility upgrade is startable
    // (every credit rung wants FA level 3+ and/or credits the fresh player lacks). Grant just
    // the Shipyard FOUNDING rung's exact gates (credits 2000 + FA level 3, materials {}), while
    // staying UNDER the 5000-credit research/fabricator rungs and with 0 commonOre (so the
    // Refinery founding rung's 100-ore cost stays unmet). That leaves EXACTLY one facility
    // (shipyard) whose next upgrade canBuildFacilityUpgrade approves. In the single case the
    // prompt NAMES that facility ("Shipyard upgrade ready") and carries its facilityKey so the
    // UI can deep-link straight to it, instead of the generic "1 facility upgrade ready".
    const oneReady = { ...freshState(), credits: new Decimal(2000), fleetAdminLevel: 3 };
    const model = buildHomeDashboard(oneReady);
    const upgrade = promptById(model, "idle-facility-upgrade");
    expect(upgrade).toBeDefined();
    expect(upgrade!.jumpTarget).toBe("facilities");
    expect(upgrade!.label).toBe("Shipyard upgrade ready");
    expect(upgrade!.facilityKey).toBe("shipyard");
    expect(model.allCaughtUp).toBe(false);
  });

  it("pluralizes the aggregate facility-upgrade prompt and carries the count when several are startable", () => {
    // Ample credits + FA level 3 clears the credit + FA gates on MULTIPLE facilities at once
    // (the Shipyard founding rung AND the Research + Fabricator level 1->2 rungs), so more than
    // one facility is startable. The prompt must read the PLURAL "N facility upgrades ready" with
    // the real count as its leading number (proving both the pluralization and count-in-label),
    // still routed to the Facilities overview.
    const manyReady = { ...freshState(), credits: new Decimal(1e12), fleetAdminLevel: 3 };
    const model = buildHomeDashboard(manyReady);
    const upgrade = promptById(model, "idle-facility-upgrade");
    expect(upgrade).toBeDefined();
    expect(upgrade!.jumpTarget).toBe("facilities");
    // Label shape "N facility upgrades ready" with N >= 2 (parse the leading count off the label).
    const match = upgrade!.label.match(/^(\d+) facility upgrades ready$/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
    // The aggregate (multi) case carries NO facilityKey: there is no single facility to
    // deep-link to, so the UI routes to the Facilities overview via jumpTarget alone.
    expect(upgrade!.facilityKey).toBeUndefined();
  });

  it("produces NO facility-upgrade prompt for a fresh admiral (nothing affordable/unlocked)", () => {
    // freshState: credits 0, Fleet Admiral level 1, 0 commonOre. Every facility's next rung is
    // blocked (unmet credits / FA level / materials, or a lone maxed rung), so canBuildFacilityUpgrade
    // is ok for none of them. The idle-but-nothing-available rule => no upgrade prompt at all.
    const model = buildHomeDashboard(freshState());
    expect(promptById(model, "idle-facility-upgrade")).toBeUndefined();
  });
});

// ============================================================================
// Unit 3: NOT YET UNLOCKED (locked / coming-soon chips)
//
// Locks buildLocked's two sources (design Section 6): the STATIC reserved coming-soon
// features (always present, independent of save state) and the DERIVED not-yet-built
// facilities (any facility at level 0). States are built BY HAND from freshState() and
// mutated to force one exact facility-level shape each, so the level-0 vs leveled split is
// deterministic. Chips are located by id (never array index) so ordering changes don't
// break these.
// ============================================================================

// Locate a locked chip by id (undefined = no such chip), so each assertion reads by id.
function lockedById(model: ReturnType<typeof buildHomeDashboard>, id: string) {
  return model.locked.find((s) => s.id === id);
}

// A facilities map with EVERY facility built (level 1), so buildLocked emits NO facility
// chips and only the static reserved features remain. Mirrors freshState's facility key set.
function allBuiltFacilities() {
  return {
    refinery: { level: 1 },
    warehouseT1: { level: 1 },
    warehouseT2: { level: 1 },
    fuelStorage: { level: 1 },
    missionControl: { level: 1 },
    research: { level: 1 },
    fabricator: { level: 1 },
    shipyard: { level: 1 },
  };
}

describe("buildHomeDashboard, locked slots (Unit 3)", () => {
  it("always surfaces the reserved coming-soon features, regardless of facility levels", () => {
    // Every facility built (no facility chips), so ONLY the static reserved features remain.
    // All four must be present with their mirrored labels, and none of the remaining chips
    // is a facility chip.
    const allBuilt = { ...freshState(), facilities: allBuiltFacilities() };
    const model = buildHomeDashboard(allBuilt);

    const crew = lockedById(model, "locked-crewEquipment");
    const achievements = lockedById(model, "locked-achievements");
    const completion = lockedById(model, "locked-completion");
    const leaderboards = lockedById(model, "locked-leaderboards");
    expect(crew?.label).toBe("Crew Equipment");
    expect(achievements?.label).toBe("Achievements");
    expect(completion?.label).toBe("Completion");
    expect(leaderboards?.label).toBe("Leaderboards");
    // Reserved features read as "Coming soon".
    expect(crew?.note).toBe("Coming soon");
    // With every facility at level 1, there are no facility chips at all.
    expect(model.locked.some((s) => s.id.startsWith("locked-facility-"))).toBe(false);
    // Exactly the four reserved features, nothing else.
    expect(model.locked.length).toBe(4);
  });

  it("surfaces a level-0 facility as a not-built chip and omits a leveled one", () => {
    // freshState seeds the Refinery + Shipyard at level 0 (unbuilt/unfounded) and the
    // Research Lab at level 1 (built). So the Refinery + Shipyard get chips; Research does not.
    const model = buildHomeDashboard(freshState());

    const refinery = lockedById(model, "locked-facility-refinery");
    expect(refinery).toBeDefined();
    expect(refinery!.label).toBe("Refinery");   // real FACILITIES label, not the raw key
    expect(refinery!.note).toBe("Not built yet");

    // The Shipyard reads with the game's FOUNDING language, not "built".
    const shipyard = lockedById(model, "locked-facility-shipyard");
    expect(shipyard).toBeDefined();
    expect(shipyard!.note).toBe("Not founded yet");

    // A leveled facility (Research Lab, level 1) contributes NO chip.
    expect(lockedById(model, "locked-facility-research")).toBeUndefined();

    // And NOT every level-0 facility: warehouseT1 + fuelStorage are OPERATIONAL at level 0
    // (usable cap / storage from the start), and warehouseT2 is an internal tier, so none of
    // them may get a "not built" chip (that would mislead about a working facility). Only the
    // genuinely-foundable-from-scratch set (refinery + shipyard) surfaces.
    expect(lockedById(model, "locked-facility-warehouseT1")).toBeUndefined();
    expect(lockedById(model, "locked-facility-fuelStorage")).toBeUndefined();
    expect(lockedById(model, "locked-facility-warehouseT2")).toBeUndefined();
  });

  it("orders the reserved features before the facility chips", () => {
    // Design Section 6 order: reserved coming-soon features first, then not-built facilities.
    const model = buildHomeDashboard(freshState());
    const firstFacilityIndex = model.locked.findIndex((s) => s.id.startsWith("locked-facility-"));
    const lastReservedIndex = model.locked.reduce(
      (acc, s, i) => (s.id.startsWith("locked-facility-") ? acc : i),
      -1,
    );
    // Every reserved feature sits ahead of the first facility chip.
    expect(lastReservedIndex).toBeLessThan(firstFacilityIndex);
  });
});

// ============================================================================
// RECENTLY COMPLETED (Crafting 0.13.3, Unit 4.4b)
//
// The companion section to IN PROGRESS. These cases lock the VIEW half: the stored
// records carry ids and amounts only, so the model must resolve them to labels,
// rarities and run details without inventing anything, and must present them newest
// first inside the board's display window.
// ============================================================================

// One stored record, with sane defaults so a case only states the fields it is about.
function completionRecord(over: Partial<CompletionLogEntry> = {}): CompletionLogEntry {
  return {
    id: "done-1",
    kind: "refineJob",
    reward: "materials",
    atMs: 1_700_000_000_000,
    startedAtMs: 1_700_000_000_000 - 12_000,
    iterations: 1,
    items: [],
    pieces: 0,
    subjectKey: null,
    level: null,
    fuelAmount: null,
    creditsAmount: null,
    stale: false,
    ...over,
  };
}

function withLog(entries: CompletionLogEntry[]): GameState {
  return { ...freshState(), completionLog: entries };
}

describe("buildHomeDashboard: RECENTLY COMPLETED", () => {
  it("is empty on a save that has completed nothing", () => {
    expect(buildHomeDashboard(freshState()).recentlyCompleted).toEqual([]);
  });

  it("orders NEWEST FIRST, because the stored array is chronological", () => {
    const model = buildHomeDashboard(
      withLog([
        completionRecord({ id: "done-1" }),
        completionRecord({ id: "done-2" }),
        completionRecord({ id: "done-3" }),
      ])
    );
    expect(model.recentlyCompleted.map((r) => r.id)).toEqual(["done-3", "done-2", "done-1"]);
  });

  it("caps the board at its display window while the save keeps the full ring buffer", () => {
    const many = Array.from({ length: HOME_RECENT_COMPLETIONS_LIMIT + 5 }, (_, i) =>
      completionRecord({ id: `done-${i + 1}` })
    );
    const model = buildHomeDashboard(withLog(many));
    expect(model.recentlyCompleted).toHaveLength(HOME_RECENT_COMPLETIONS_LIMIT);
    // The window is the NEWEST end, so the very last stored record leads the list.
    expect(model.recentlyCompleted[0].id).toBe(`done-${many.length}`);
  });

  it("resolves reward item IDS to a label and a RARITY, leaving the color to the UI", () => {
    const model = buildHomeDashboard(
      withLog([completionRecord({ items: [{ itemId: "titaniumIngot", amount: "40" }], subjectKey: "titaniumIngot" })])
    );
    const row = model.recentlyCompleted[0];
    expect(row.rewards).toEqual([
      {
        itemId: "titaniumIngot",
        label: ITEMS.titaniumIngot.label,
        rarity: ITEMS.titaniumIngot.rarity,
        // The RAW amount rides through: the UI runs it through the app's formatNumber, so
        // this module never invents a second number format.
        amount: "40",
      },
    ]);
    expect(row.primaryLabel).toBe(`Refined, ${ITEMS.titaniumIngot.label}`);
  });

  it("reads a folded batch as ONE row that says how many runs it was", () => {
    const model = buildHomeDashboard(
      withLog([completionRecord({ iterations: 40, items: [{ itemId: "titaniumIngot", amount: "40" }] })])
    );
    expect(model.recentlyCompleted).toHaveLength(1);
    expect(model.recentlyCompleted[0].secondaryLabel).toBe("40 runs");
  });

  it("gives each reward SHAPE its own honest reading", () => {
    const hullKey = Object.keys(SHIP_TYPES)[0];
    const model = buildHomeDashboard(
      withLog([
        completionRecord({ id: "d-research", kind: "researchProject", reward: "blueprint", subjectKey: "frameSegmentBp" }),
        completionRecord({ id: "d-build", kind: "shipBuild", reward: "hull", subjectKey: hullKey }),
        completionRecord({ id: "d-upgrade", kind: "facilityUpgrade", reward: "level", subjectKey: "refinery", level: 3 }),
        completionRecord({ id: "d-docks", kind: "docksExpansion", reward: "level", subjectKey: "docks", level: 9 }),
        completionRecord({ id: "d-fuel", kind: "fuelRefineJob", reward: "fuel", fuelAmount: "25" }),
        completionRecord({ id: "d-stale", kind: "salvageJob", reward: "nothing", subjectKey: "equip-9", stale: true }),
      ])
    );
    const byId = new Map(model.recentlyCompleted.map((r) => [r.id, r]));
    expect(byId.get("d-research")!.primaryLabel).toBe(`Researched, ${BLUEPRINTS.frameSegmentBp.label}`);
    expect(byId.get("d-build")!.primaryLabel).toBe(`Built, ${SHIP_TYPES[hullKey as keyof typeof SHIP_TYPES].label}`);
    // An upgrade grants a LEVEL, not items, and says so.
    expect(byId.get("d-upgrade")!.secondaryLabel).toBe("Level 3");
    // The docks store a capacity rather than a level, so they report berths.
    expect(byId.get("d-docks")!.secondaryLabel).toBe("9 berths");
    // Fuel has one name, so the verb carries it and no subject is invented.
    expect(byId.get("d-fuel")!.primaryLabel).toBe("Refined");
    // The fail-safe no-op reassures rather than going silent.
    expect(byId.get("d-stale")!.secondaryLabel).toBe("Nothing was consumed");
  });

  it("reports an elapsed span only when BOTH stamps are real", () => {
    const model = buildHomeDashboard(
      withLog([
        completionRecord({ id: "d-timed", atMs: 5_000, startedAtMs: 2_000 }),
        completionRecord({ id: "d-unknown", atMs: 0, startedAtMs: 0 }),
      ])
    );
    const byId = new Map(model.recentlyCompleted.map((r) => [r.id, r]));
    expect(byId.get("d-timed")!.elapsedMs).toBe(3_000);
    // No injected clock means no fabricated duration.
    expect(byId.get("d-unknown")!.elapsedMs).toBeNull();
  });

  it("never affects allCaughtUp: a finished order is a record, not an action", () => {
    const busy = withLog([completionRecord()]);
    expect(buildHomeDashboard(busy).recentlyCompleted).toHaveLength(1);
    expect(buildHomeDashboard(busy).allCaughtUp).toBe(buildHomeDashboard(freshState()).allCaughtUp);
  });
});
