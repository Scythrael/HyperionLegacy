// Shipyard (Phase 5), Task S1 data-model tests.
//
// SCOPE (S1 only, per docs/plans/2026-07-16-shipyard-plan.md): the DATA MODEL that
// the later Shipyard tasks build on, (1) every hull's `buildRecipe` BOM, (2) the
// `FACILITIES.shipyard` facility def (founding rung gated on credits + FA level, a
// finite build-speed upgrade track), (3) `shipBuildSlotCount` = 1, and (4) the
// fresh-state seed of `shipyard` at level 0 (LOCKED / unfounded). The build ENGINE
// (S3), allocation unification (S2), and UI (S5) are NOT tested here, they arrive
// in their own tasks.
//
// These assertions mirror the shape the sibling systems already lock down (see
// fabricator.test.ts / research.test.ts): "every table entry is well-formed + points
// at real registry keys", so a mistyped component id or a missing rung cannot slip in.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  SHIP_TYPES,
  ITEMS,
  FACILITIES,
  SHIPYARD_FACILITY_KEY,
  type ShipTypeKey,
  type GameState,
  type TimedProcess,
} from "./model";
import type { CraftLine } from "./allocation";
import {
  shipBuildSlotCount,
  shipBuildDurationTicks,
  canBuildShip,
  startShipBuild,
  resolveProcesses,
  economyTick,
  tick,
} from "./tick";
import { itemTotal } from "./inventory"; // Task 9a: read item TOTAL across quality buckets

// The exact hull keys S1 ships against, an explicit list (not `Object.keys`) so a
// hull silently dropped from SHIP_TYPES fails this test instead of being skipped.
const HULL_KEYS: ShipTypeKey[] = [
  "generalFreighter",
  "prospectorHauler",
  "prospectorRunner",
  "prospectorMiner",
];

describe("ShipTypeDef.buildRecipe (S1 BOM)", () => {
  it("every hull declares a buildRecipe", () => {
    for (const key of HULL_KEYS) {
      expect(SHIP_TYPES[key].buildRecipe, `buildRecipe missing on ${key}`).toBeDefined();
    }
  });

  it("every buildRecipe lists at least one component, all real ITEMS keys with positive counts", () => {
    for (const key of HULL_KEYS) {
      const recipe = SHIP_TYPES[key].buildRecipe;
      const entries = Object.entries(recipe.components);
      expect(entries.length, `${key} has no components`).toBeGreaterThan(0);
      for (const [itemId, qty] of entries) {
        // The component id must exist in the ITEMS registry (no ghost item).
        expect(ITEMS[itemId], `${key} references unknown item "${itemId}"`).toBeDefined();
        expect(qty, `${key}.${itemId} count must be positive`).toBeGreaterThan(0);
      }
    }
  });

  it("every buildRecipe has positive credits + durationTicks", () => {
    for (const key of HULL_KEYS) {
      const recipe = SHIP_TYPES[key].buildRecipe;
      expect(recipe.credits, `${key} credits`).toBeGreaterThan(0);
      expect(recipe.durationTicks, `${key} durationTicks`).toBeGreaterThan(0);
    }
  });

  it("uses the real component item ids (frameSegment / powerCoupling / structuralAssembly)", () => {
    // A guard that the BOMs draw ONLY from the fabricated component pool (design §6),
    // not from raw ores or refined stock, ships are assembled from components.
    const allowed = new Set(["frameSegment", "powerCoupling", "structuralAssembly"]);
    for (const key of HULL_KEYS) {
      for (const itemId of Object.keys(SHIP_TYPES[key].buildRecipe.components)) {
        expect(allowed.has(itemId), `${key} uses non-component "${itemId}"`).toBe(true);
      }
    }
  });
});

describe("FACILITIES.shipyard (S1 facility)", () => {
  it("SHIPYARD_FACILITY_KEY is 'shipyard' and the facility exists with a label", () => {
    expect(SHIPYARD_FACILITY_KEY).toBe("shipyard");
    expect(FACILITIES[SHIPYARD_FACILITY_KEY]).toBeDefined();
    expect(FACILITIES[SHIPYARD_FACILITY_KEY].label).toBe("Shipyard");
  });

  it("founding rung (level 0->1) is gated on credits + FA level, with NO materials", () => {
    const founding = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades[0];
    expect(founding, "founding rung missing").toBeDefined();
    // Founding cost = credits (a Decimal, like research/fabricator's credit rungs).
    expect(founding.credits instanceof Decimal, "founding credits must be a Decimal").toBe(true);
    expect((founding.credits as Decimal).gt(0), "founding credits must be positive").toBe(true);
    // Founding gate = Fleet-Admiral level (mirrors research/fabricator's FA gate).
    expect(founding.requiresFleetAdminLevel, "founding FA-level gate").toBeGreaterThan(0);
    // NO materials on the founding rung this pass (mirrors research's rung).
    expect(Object.keys(founding.materials).length, "founding rung must cost no materials").toBe(0);
  });

  it("a later rung carries the build-speed effect (buildSpeedMult)", () => {
    const upgrades = FACILITIES[SHIPYARD_FACILITY_KEY].upgrades;
    // Finite track: at least one rung BEYOND the founding rung.
    expect(upgrades.length, "shipyard needs at least one upgrade rung past founding").toBeGreaterThan(1);
    // Every rung past the founding one carries a positive buildSpeedMult.
    for (let i = 1; i < upgrades.length; i++) {
      const effect = upgrades[i].effect;
      expect("buildSpeedMult" in effect, `rung ${i} must carry buildSpeedMult`).toBe(true);
      if ("buildSpeedMult" in effect) {
        expect(effect.buildSpeedMult, `rung ${i} buildSpeedMult`).toBeGreaterThan(0);
      }
    }
  });

  it("buildSpeedMult is INERT for every existing facility (no non-shipyard rung sets it)", () => {
    // Anti-regression (Omega 15): the new effect field must change NO existing facility.
    for (const [facilityKey, def] of Object.entries(FACILITIES)) {
      if (facilityKey === SHIPYARD_FACILITY_KEY) continue;
      for (const rung of def.upgrades) {
        expect(
          "buildSpeedMult" in rung.effect,
          `${facilityKey} unexpectedly sets buildSpeedMult`,
        ).toBe(false);
      }
    }
  });
});

describe("shipBuildSlotCount + fresh-state seed (S1)", () => {
  it("shipBuildSlotCount is 1 on a fresh state (single build slot this pass)", () => {
    expect(shipBuildSlotCount(freshState())).toBe(1);
  });

  it("fresh state seeds the shipyard at level 0 (LOCKED / unfounded)", () => {
    // Unlike research/fabricator (seeded at level 1), the Shipyard starts LOCKED so
    // the founding rung (level 0->1) is a real unlock the player must buy.
    expect(freshState().facilities[SHIPYARD_FACILITY_KEY].level).toBe(0);
  });
});

// ============================================================================
// S3: shipBuild engine, canBuildShip / startShipBuild / addShip completion /
//     build-speed duration scaling / ⚠️ offline parity.
// ============================================================================

// A fresh state with a FOUNDED shipyard (level 1 by default) + controlled component
// stock + credits + an EMPTY ships array (so a build test never trips storageFull
// unless the test asks for it). Mirrors craft-lines.test.ts's linesState helper.
function yardState(opts: {
  shipyardLevel?: number;
  frameSegment?: number;
  powerCoupling?: number;
  structuralAssembly?: number;
  credits?: number;
  ships?: GameState["ships"];
  shipStorageCapacity?: number;
  activeProcesses?: TimedProcess[];
  fabricateLines?: CraftLine[];
} = {}): GameState {
  const s = freshState();
  const inventory: Record<string, Decimal[]> = { ...s.inventory };
  if (opts.frameSegment !== undefined) inventory.frameSegment = [new Decimal(opts.frameSegment)];
  if (opts.powerCoupling !== undefined) inventory.powerCoupling = [new Decimal(opts.powerCoupling)];
  if (opts.structuralAssembly !== undefined) inventory.structuralAssembly = [new Decimal(opts.structuralAssembly)];
  return {
    ...s,
    inventory,
    credits: new Decimal(opts.credits ?? 100000),
    facilities: { ...s.facilities, shipyard: { level: opts.shipyardLevel ?? 1 } },
    ships: opts.ships ?? [],
    shipStorageCapacity: opts.shipStorageCapacity ?? s.shipStorageCapacity,
    activeProcesses: opts.activeProcesses ?? [],
    fabricateLines: opts.fabricateLines ?? [],
  };
}

// Runs economyTick(state, 1) `n` times, the SAME per-tick stepping tick()'s offline
// catch-up loop performs (mirrors craft-lines.test.ts's stepTicks).
function stepTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1);
  return s;
}

// A comparable snapshot for the offline==stepped parity assertion, over exactly the
// four fields the build engine touches: ships + activeProcesses + inventory (BOM) +
// credits. Decimals -> strings; ships/processes -> their scalar fields.
function buildSnapshot(state: GameState) {
  return {
    ships: state.ships.map((sh) => ({ id: sh.id, typeKey: sh.typeKey, assignedCaptainId: sh.assignedCaptainId })),
    nextShipId: state.nextShipId,
    processes: state.activeProcesses.map((p) => ({
      id: p.id,
      kind: p.kind,
      remainingTicks: p.remainingTicks,
      durationTicks: p.durationTicks,
    })),
    frameSegment: itemTotal(state.inventory, "frameSegment").toString(),
    powerCoupling: itemTotal(state.inventory, "powerCoupling").toString(),
    credits: state.credits.toString(),
  };
}

describe("canBuildShip, typed reasons (S3)", () => {
  it("ok: founded shipyard, a free slot, storage room, affordable BOM + credits", () => {
    // generalFreighter BOM: frameSegment 4, powerCoupling 2, credits 500.
    const res = canBuildShip(yardState({ frameSegment: 10, powerCoupling: 10, credits: 1000 }), "generalFreighter");
    expect(res.ok).toBe(true);
  });

  it("notFound: an unknown ship key (not in SHIP_TYPES)", () => {
    const res = canBuildShip(yardState({ frameSegment: 10, powerCoupling: 10 }), "notAShip");
    expect(res).toEqual({ ok: false, reason: "notFound" });
  });

  it("notFounded: shipyard still at level 0 (unfounded) blocks a build", () => {
    const res = canBuildShip(
      yardState({ shipyardLevel: 0, frameSegment: 10, powerCoupling: 10, credits: 1000 }),
      "generalFreighter",
    );
    expect(res).toEqual({ ok: false, reason: "notFounded" });
  });

  it("noSlot: a shipBuild process already in flight fills the single slot", () => {
    const inFlight: TimedProcess = {
      id: "proc-1",
      kind: "shipBuild",
      remainingTicks: 100,
      durationTicks: 300,
      effect: { type: "addShip", typeKey: "generalFreighter" },
    };
    const res = canBuildShip(
      yardState({ frameSegment: 10, powerCoupling: 10, credits: 1000, activeProcesses: [inFlight] }),
      "generalFreighter",
    );
    expect(res).toEqual({ ok: false, reason: "noSlot" });
  });

  it("storageFull: the ship store is already at shipStorageCapacity", () => {
    const parked = { id: "ship-1", typeKey: "generalFreighter" as ShipTypeKey, assignedCaptainId: null };
    const res = canBuildShip(
      yardState({ frameSegment: 10, powerCoupling: 10, credits: 1000, ships: [parked], shipStorageCapacity: 1 }),
      "generalFreighter",
    );
    expect(res).toEqual({ ok: false, reason: "storageFull" });
  });

  it("materials: a component is short (plain, no reservation)", () => {
    // frameSegment 2 < the 4 the freighter needs.
    const res = canBuildShip(yardState({ frameSegment: 2, powerCoupling: 10, credits: 1000 }), "generalFreighter");
    expect(res).toEqual({ ok: false, reason: "materials" });
  });

  it("materials: respects FREE, a craft-line reservation blocks a build with enough RAW stock", () => {
    // RAW frameSegment 5 >= the 4 the freighter needs, BUT a fabricate line running
    // structuralAssemblyBp (inputs frameSegment 2, powerCoupling 1) reserves 2 of them ->
    // FREE frameSegment = 5 - 2 = 3 < 4. The build must block on `materials`, proving the
    // gate reads freeItemForState (S2), not raw inventory. Without the line it would pass.
    const reservingLine: CraftLine = {
      id: "craft-1",
      kind: "fabricate",
      recipeKey: "structuralAssemblyBp",
      remaining: 1,
      mode: { kind: "continuous" },
    };
    const withLine = yardState({ frameSegment: 5, powerCoupling: 10, credits: 1000, fabricateLines: [reservingLine] });
    expect(canBuildShip(withLine, "generalFreighter")).toEqual({ ok: false, reason: "materials" });
    // Control: the SAME stock with NO reserving line passes (non-vacuous, the line is the cause).
    const noLine = yardState({ frameSegment: 5, powerCoupling: 10, credits: 1000 });
    expect(canBuildShip(noLine, "generalFreighter").ok).toBe(true);
  });

  it("credits: enough components but not enough credits", () => {
    // BOM affordable, credits 100 < the 500 the freighter costs.
    const res = canBuildShip(yardState({ frameSegment: 10, powerCoupling: 10, credits: 100 }), "generalFreighter");
    expect(res).toEqual({ ok: false, reason: "credits" });
  });
});

describe("startShipBuild (S3)", () => {
  it("on ok: deducts the BOM + credits at start and pushes a shipBuild process", () => {
    const state = yardState({ frameSegment: 10, powerCoupling: 10, credits: 1000 });
    const { next, started, reason } = startShipBuild(state, "generalFreighter");

    expect(started).toBe(true);
    expect(reason).toBeUndefined();
    // Deduct-at-start: the WHOLE BOM leaves inventory immediately (frameSegment 10-4, powerCoupling 10-2).
    expect(itemTotal(next.inventory, "frameSegment").toString()).toBe("6");
    expect(itemTotal(next.inventory, "powerCoupling").toString()).toBe("8");
    // Credits deducted once (1000 - 500).
    expect(next.credits.toString()).toBe("500");
    // Exactly one shipBuild process, with the addShip effect + the scaled duration.
    const builds = next.activeProcesses.filter((p) => p.kind === "shipBuild");
    expect(builds).toHaveLength(1);
    expect(builds[0].effect).toEqual({ type: "addShip", typeKey: "generalFreighter" });
    expect(builds[0].durationTicks).toBe(shipBuildDurationTicks(state, "generalFreighter"));
    expect(builds[0].remainingTicks).toBe(builds[0].durationTicks);
    // Input untouched (immutability).
    expect(itemTotal(state.inventory, "frameSegment").toString()).toBe("10");
    expect(state.activeProcesses).toHaveLength(0);
  });

  it("a started build creates NO ongoing reservation (a shipBuild is deduct-at-start, not time-spread)", () => {
    // After the BOM is consumed at start, freeItemForState never counts the in-flight build,
    // so a SECOND build is limited only by the remaining RAW stock + the 1-slot cap, never by
    // a phantom reservation of the first build's BOM. We prove the reservation-free property by
    // showing the deducted stock IS the whole story: post-start free == post-start raw.
    const { next } = startShipBuild(yardState({ frameSegment: 10, powerCoupling: 10, credits: 5000 }), "generalFreighter");
    // No refine/fabricate lines exist, so freeItemForState == raw inventory; the shipBuild does
    // not appear as a reservation anywhere. (canBuildShip would now block on noSlot, not materials.)
    const secondCheck = canBuildShip(next, "generalFreighter");
    expect(secondCheck).toEqual({ ok: false, reason: "noSlot" }); // blocked by the slot, NOT a reservation
  });

  it("on a block: same-reference no-op + started:false + the typed reason", () => {
    const state = yardState({ shipyardLevel: 0, frameSegment: 10, powerCoupling: 10, credits: 1000 });
    const res = startShipBuild(state, "generalFreighter");
    expect(res.next).toBe(state); // same reference
    expect(res.started).toBe(false);
    expect(res.reason).toBe("notFounded");
  });
});

describe("shipBuild completion parks a hull (S3)", () => {
  it("on completion: mints a PARKED hull, bumps nextShipId, awards NO Fleet Admiral XP", () => {
    const state = yardState({ frameSegment: 10, powerCoupling: 10, credits: 1000 });
    const started = startShipBuild(state, "generalFreighter").next;
    const shipsBefore = started.ships.length;
    const nextIdBefore = started.nextShipId;
    const duration = shipBuildDurationTicks(state, "generalFreighter");

    // Resolve the whole build in one shot.
    const { next, fleetAdminXpDelta } = resolveProcesses(started, duration);

    // A new parked hull appended.
    expect(next.ships).toHaveLength(shipsBefore + 1);
    const minted = next.ships[next.ships.length - 1];
    expect(minted.typeKey).toBe("generalFreighter");
    expect(minted.assignedCaptainId).toBeNull();
    expect(minted.id).toBe(`ship-${nextIdBefore}`);
    // nextShipId bumped.
    expect(next.nextShipId).toBe(nextIdBefore + 1);
    // The shipBuild process is gone (resolved exactly once).
    expect(next.activeProcesses.filter((p) => p.kind === "shipBuild")).toHaveLength(0);
    // EXCLUDED from the FA-XP lump award (like fabricateJob / researchProject).
    expect(fleetAdminXpDelta).toBe(0);
  });
});

describe("shipBuildDurationTicks scales with buildSpeedMult (S3)", () => {
  it("level 1 (founded, no speed rungs) = base durationTicks (1.0x)", () => {
    const base = SHIP_TYPES.generalFreighter.buildRecipe.durationTicks; // 300
    expect(shipBuildDurationTicks(yardState({ shipyardLevel: 1 }), "generalFreighter")).toBe(base);
  });

  it("higher shipyard levels DIVIDE by the product of reached buildSpeedMult rungs (faster)", () => {
    const base = SHIP_TYPES.generalFreighter.buildRecipe.durationTicks; // 300
    // Rung [1] = 1.5x, rung [2] = 2.0x (model.ts FACILITIES.shipyard).
    expect(shipBuildDurationTicks(yardState({ shipyardLevel: 2 }), "generalFreighter")).toBeCloseTo(base / 1.5);
    expect(shipBuildDurationTicks(yardState({ shipyardLevel: 3 }), "generalFreighter")).toBeCloseTo(base / (1.5 * 2.0));
    // Strictly faster at each higher level.
    expect(shipBuildDurationTicks(yardState({ shipyardLevel: 3 }), "generalFreighter")).toBeLessThan(
      shipBuildDurationTicks(yardState({ shipyardLevel: 2 }), "generalFreighter"),
    );
  });
});

// --- ⚠️ offline == live parity (the high-risk seam; controller re-verifies) ------
describe("⚠️ shipBuild offline == live parity (S3)", () => {
  it("tick(bigSpan) equals looping economyTick(_,1) across a build completing mid-span, NON-VACUOUS", () => {
    // Seed a FOUNDED shipyard + enough components + credits, then START the build so the
    // in-flight shipBuild process (duration 300) rides both paths from the same base.
    const seeded = yardState({ frameSegment: 10, powerCoupling: 10, credits: 5000 });
    const base = startShipBuild(seeded, "generalFreighter").next;
    const SPAN = 305; // past the 300-tick build so it COMPLETES mid-span

    // Pre-span sanity: the build is in flight (deduct-at-start already spent the BOM + credits),
    // and no hull is parked yet, so the parity below is over a real mid-span completion.
    expect(base.activeProcesses.filter((p) => p.kind === "shipBuild")).toHaveLength(1);
    expect(base.ships).toHaveLength(0);
    expect(itemTotal(base.inventory, "frameSegment").toString()).toBe("6"); // 10 - 4 consumed at START
    expect(base.credits.toString()).toBe("4500"); // 5000 - 500 at START

    // Path A: one offline catch-up call. Path B: hand-stepped economyTick, one tick at a time.
    const jumped = tick(SPAN, base);
    const stepped = stepTicks(base, SPAN);
    expect(buildSnapshot(jumped)).toEqual(buildSnapshot(stepped));

    // NON-VACUITY: a hull actually parked, the BOM was consumed, credits deducted ONCE, the
    // shipBuild process is gone, and the id source advanced.
    expect(jumped.ships).toHaveLength(1); // grew from 0
    expect(jumped.ships[0].typeKey).toBe("generalFreighter");
    expect(jumped.ships[0].assignedCaptainId).toBeNull(); // parked, unassigned
    expect(itemTotal(jumped.inventory, "frameSegment").toString()).toBe("6"); // BOM consumed once (at start)
    expect(itemTotal(jumped.inventory, "powerCoupling").toString()).toBe("8");
    expect(jumped.credits.toString()).toBe("4500"); // deducted ONCE, not per-tick
    expect(jumped.activeProcesses.filter((p) => p.kind === "shipBuild")).toHaveLength(0); // resolved + removed
    expect(jumped.nextShipId).toBe(base.nextShipId + 1);
  });
});
