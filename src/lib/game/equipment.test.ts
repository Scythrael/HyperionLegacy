// ============================================================================
// Equipment 0.11.0 (Task 12): fit / unfit SYSTEM tests.
// Author: Scythrael (via Claude) | 2026-07-17
//
// Covers the pure state-transform helpers in equipment.ts:
//   - equippedFor / fittedInSlot  (queries over the fittedToShipId authority)
//   - canFitEquipment             (the fitment gate + typed block reasons)
//   - fitEquipment                (atomic single-slot swap)
//   - unfitEquipment              (return a piece to the spare pool)
//
// The one thing every test here is really pinning: EquipmentInstance.fittedToShipId
// is the SINGLE SOURCE OF TRUTH for fitment (mirrors ShipInstance.assignedCaptainId),
// so "is X fitted to ship Y" is ALWAYS `fittedToShipId === Y` and nothing else.
//
// Scope note (matches the task): this task does NOT fold equipment stats into ship
// stats (next task), and does NOT seed the Standard-Issue auto-refit invariant
// (later migration). Unfitting here simply empties the slot.
// ============================================================================
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState } from "./model";
import type { GameState, EquipmentInstance, EquipmentSlotType } from "./model";
import {
  equippedFor,
  fittedInSlot,
  canFitEquipment,
  fitEquipment,
  unfitEquipment,
  captainBranchToShipSpec,
} from "./equipment";

// ----------------------------------------------------------------------------
// Fixtures. Deliberately MINIMAL literals rather than routing through
// generateEquipment (itemgen): fit/unfit logic only reads id / slotType /
// fittedToShipId, so the rolled stat internals are noise here. Building the
// instance by hand keeps each test's inputs painfully explicit.
// ----------------------------------------------------------------------------

// A bare, well-typed EquipmentInstance with the fields the fit system reads set
// explicitly and every other required field filled with an inert baseline. `over`
// lets a test override just the field it is isolating (id / slotType / fitment).
function makeEquip(over: Partial<EquipmentInstance> & { id: string }): EquipmentInstance {
  return {
    id: over.id,
    slotType: over.slotType ?? "cargoBay",
    rarity: over.rarity ?? "standard",
    ascension: over.ascension ?? "none",
    quality: over.quality ?? 0,
    blueprintKey: over.blueprintKey ?? null,
    implicitStats: over.implicitStats ?? {},
    rolledStats: over.rolledStats ?? {},
    mass: over.mass ?? 0,
    powerDraw: over.powerDraw ?? 0,
    durabilityMax: over.durabilityMax ?? 100,
    durability: over.durability ?? 100,
    fittedToShipId: over.fittedToShipId ?? null,
  };
}

// freshState() seeds captain id 1 (spec null, mission null) flying "ship-1"
// (generalFreighter, spec "general"). These small mutators shape that seed into
// the exact scenario each test needs, changing ONE dimension at a time.

// Put the seeded ship on a specific hull type.
function withHull(state: GameState, typeKey: GameState["ships"][number]["typeKey"]): GameState {
  return { ...state, ships: [{ ...state.ships[0], typeKey }] };
}

// Give the seeded captain (id 1) a chosen specialization branch.
function withCaptainSpec(state: GameState, spec: GameState["captains"][number]["spec"]): GameState {
  return { ...state, captains: [{ ...state.captains[0], spec }] };
}

// Put the seeded captain (id 1) on an active mission (any live mission state).
function withCaptainOnMission(state: GameState): GameState {
  const mission = {
    missionKey: "shortOreRun" as const,
    phase: "transitOut" as const,
    phaseProgressTicks: 0,
    recalled: false,
    cargo: { commonOre: new Decimal(0), uncommonMaterial: new Decimal(0), rareMaterial: new Decimal(0) },
  };
  return { ...state, captains: [{ ...state.captains[0], mission }] };
}

// Park the ship: no captain assigned (assignedCaptainId null).
function parked(state: GameState): GameState {
  return { ...state, ships: [{ ...state.ships[0], assignedCaptainId: null }] };
}

// Seed one or more equipment instances into the pool.
function withEquipment(state: GameState, ...pieces: EquipmentInstance[]): GameState {
  return { ...state, equipment: pieces };
}

// ----------------------------------------------------------------------------
// captainBranchToShipSpec: the branch -> ShipSpec bridge the captainSpec gate uses
// ----------------------------------------------------------------------------
describe("captainBranchToShipSpec", () => {
  it("maps the three captain branches onto their ShipSpec equivalents (per specCards)", () => {
    expect(captainBranchToShipSpec("resourcefulness")).toBe("prospector");
    expect(captainBranchToShipSpec("tactical")).toBe("tactician");
    expect(captainBranchToShipSpec("science")).toBe("explorer");
  });
});

// ----------------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------------
describe("equippedFor / fittedInSlot", () => {
  it("equippedFor returns exactly the pieces whose fittedToShipId is that ship", () => {
    const fitted = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const spare = makeEquip({ id: "equip-2", slotType: "cargoBay", fittedToShipId: null });
    const otherShip = makeEquip({ id: "equip-3", slotType: "cargoBay", fittedToShipId: "ship-9" });
    const state = withEquipment(freshState(), fitted, spare, otherShip);

    const result = equippedFor(state, "ship-1");
    expect(result.map((e) => e.id)).toEqual(["equip-1"]);
  });

  it("fittedInSlot returns the piece in that ship's slot, or null when empty", () => {
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const state = withEquipment(freshState(), cargo);

    expect(fittedInSlot(state, "ship-1", "cargoBay")?.id).toBe("equip-1");
    expect(fittedInSlot(state, "ship-1", "ftlDrive")).toBeNull(); // slot empty
    expect(fittedInSlot(state, "ship-9", "cargoBay")).toBeNull(); // different ship
  });
});

// ----------------------------------------------------------------------------
// fitEquipment: sets fitment, and the atomic single-slot swap
// ----------------------------------------------------------------------------
describe("fitEquipment", () => {
  it("sets fittedToShipId and equippedFor reflects it", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });
    const state = withEquipment(freshState(), piece);

    const next = fitEquipment(state, "ship-1", "equip-1");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBe("ship-1");
    expect(equippedFor(next, "ship-1").map((e) => e.id)).toEqual(["equip-1"]);
  });

  it("ATOMIC SWAP: fitting a second piece of the SAME slot unfits the first (first back to pool, only the second fitted)", () => {
    const first = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" }); // already in the cargo slot
    const second = makeEquip({ id: "equip-2", slotType: "cargoBay", fittedToShipId: null }); // spare, same slot
    const state = withEquipment(freshState(), first, second);

    const next = fitEquipment(state, "ship-1", "equip-2");

    // First piece is evicted back to the spare pool:
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    // Second piece is now the one fitted:
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1");
    // The slot holds EXACTLY ONE piece:
    const inSlot = next.equipment.filter((e) => e.fittedToShipId === "ship-1" && e.slotType === "cargoBay");
    expect(inSlot.map((e) => e.id)).toEqual(["equip-2"]);
  });

  it("does NOT disturb a DIFFERENT slot on the same ship when swapping", () => {
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const drive = makeEquip({ id: "equip-2", slotType: "ftlDrive", fittedToShipId: "ship-1" });
    const newCargo = makeEquip({ id: "equip-3", slotType: "cargoBay", fittedToShipId: null });
    const state = withEquipment(freshState(), cargo, drive, newCargo);

    const next = fitEquipment(state, "ship-1", "equip-3");

    // The ftlDrive piece is untouched:
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1");
    // Only the cargo slot swapped:
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(next.equipment.find((e) => e.id === "equip-3")?.fittedToShipId).toBe("ship-1");
  });
});

// ----------------------------------------------------------------------------
// On-mission lock (mirrors assignShipToCaptain's captain.mission !== null gate)
// ----------------------------------------------------------------------------
describe("on-mission lock", () => {
  it("canFitEquipment blocks when the ship's captain is on an active mission", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });
    const state = withCaptainOnMission(withEquipment(freshState(), piece));

    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "onMission" });
  });

  it("fitEquipment throws when the ship's captain is on an active mission", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });
    const state = withCaptainOnMission(withEquipment(freshState(), piece));

    expect(() => fitEquipment(state, "ship-1", "equip-1")).toThrow(/onMission/);
  });

  it("unfitEquipment throws when the ship's captain is on an active mission", () => {
    const fitted = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const state = withCaptainOnMission(withEquipment(freshState(), fitted));

    expect(() => unfitEquipment(state, "ship-1", "cargoBay")).toThrow(/onMission/);
  });

  it("ALLOWS fitting when the ship is parked (no captain), an idle captain, or a recalled captain", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });

    // Parked: ship has no captain at all.
    const parkedState = parked(withEquipment(freshState(), piece));
    expect(canFitEquipment(parkedState, "ship-1", "equip-1")).toEqual({ ok: true });

    // Idle / recalled: the captain's mission has fully resolved to null (recall
    // takes effect at end-of-cycle, mirror of assignShipToCaptain's mission !== null lock).
    const idleState = withEquipment(freshState(), piece); // seeded captain has mission null
    expect(canFitEquipment(idleState, "ship-1", "equip-1")).toEqual({ ok: true });
  });
});

// ----------------------------------------------------------------------------
// equipRequirement gate (specUtility = Prospecting Rig: prospector captain + hull)
// ----------------------------------------------------------------------------
describe("equipRequirement gate", () => {
  // A specUtility (Prospecting Rig) piece: requires captainSpec prospector + hullSpec prospector.
  const rig = () => makeEquip({ id: "equip-1", slotType: "specUtility", fittedToShipId: null });

  it("a Prospecting Rig CANNOT fit a non-Prospector hull", () => {
    // General Freighter hull (spec "general") + a prospector captain -> hull gate fails.
    const state = withCaptainSpec(withEquipment(freshState(), rig()), "resourcefulness");
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "hullSpec" });
  });

  it("a Prospecting Rig CANNOT fit with a non-prospector captain", () => {
    // Prospector hull, but the captain chose the tactical branch -> captain gate fails.
    const state = withCaptainSpec(withHull(withEquipment(freshState(), rig()), "prospectorMiner"), "tactical");
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "captainSpec" });
  });

  it("a Prospecting Rig CANNOT fit when the captain has chosen no spec yet", () => {
    // Prospector hull, captain spec still null.
    const state = withHull(withEquipment(freshState(), rig()), "prospectorMiner"); // seeded captain spec is null
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "captainSpec" });
  });

  it("a Prospecting Rig CANNOT fit a parked Prospector hull (captainSpec required but no captain)", () => {
    const state = parked(withHull(withEquipment(freshState(), rig()), "prospectorMiner"));
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "captainSpecParked" });
  });

  it("a Prospecting Rig CAN fit a prospecting captain on a Prospector hull", () => {
    const state = withCaptainSpec(withHull(withEquipment(freshState(), rig()), "prospectorMiner"), "resourcefulness");
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: true });

    // And the fit actually lands:
    const next = fitEquipment(state, "ship-1", "equip-1");
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBe("ship-1");
  });

  it("a UNIVERSAL slot (cargoBay) has no spec/hull gate, fits any hull + captain", () => {
    // General Freighter, captain with no spec: a cargoBay piece still fits.
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });
    const state = withEquipment(freshState(), cargo);
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: true });
  });
});

// ----------------------------------------------------------------------------
// Missing-entity guards
// ----------------------------------------------------------------------------
describe("missing-entity guards", () => {
  it("canFitEquipment reports noInstance for an unknown instance id", () => {
    expect(canFitEquipment(freshState(), "ship-1", "equip-nope")).toEqual({ ok: false, reason: "noInstance" });
  });

  it("canFitEquipment reports noShip for an unknown ship id", () => {
    const piece = makeEquip({ id: "equip-1", fittedToShipId: null });
    const state = withEquipment(freshState(), piece);
    expect(canFitEquipment(state, "ship-nope", "equip-1")).toEqual({ ok: false, reason: "noShip" });
  });
});

// ----------------------------------------------------------------------------
// unfitEquipment: returns the piece to the pool
// ----------------------------------------------------------------------------
describe("unfitEquipment", () => {
  it("returns the piece in that slot to the pool (fittedToShipId null)", () => {
    const fitted = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const state = withEquipment(freshState(), fitted);

    const next = unfitEquipment(state, "ship-1", "cargoBay");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(equippedFor(next, "ship-1")).toEqual([]); // slot now empty
  });

  it("is a no-op (same-ref) when the slot is already empty", () => {
    const state = withEquipment(freshState()); // nothing fitted
    const next = unfitEquipment(state, "ship-1", "cargoBay");
    expect(next).toBe(state); // unchanged reference, nothing to unfit
  });

  it("only unfits the named slot, leaving other fitted slots intact", () => {
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const drive = makeEquip({ id: "equip-2", slotType: "ftlDrive", fittedToShipId: "ship-1" });
    const state = withEquipment(freshState(), cargo, drive);

    const next = unfitEquipment(state, "ship-1", "cargoBay");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1"); // drive untouched
  });
});
