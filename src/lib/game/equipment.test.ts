// ============================================================================
// Equipment 0.11.0 (Task 12): fit / unfit SYSTEM tests.
// Author: Scythrael (via Claude) | 2026-07-17
//
// Covers the pure state-transform helpers in equipment.ts:
//   - equippedFor / fittedInSlot  (queries over the fittedToShipId authority)
//   - canFitEquipment             (the fitment gate + typed block reasons)
//   - fitEquipment                (atomic single-slot swap)
//   - unfitEquipment              (evict to the pool + auto-refit Standard-Issue)
//
// The one thing every test here is really pinning: EquipmentInstance.fittedToShipId
// is the SINGLE SOURCE OF TRUTH for fitment (mirrors ShipInstance.assignedCaptainId),
// so "is X fitted to ship Y" is ALWAYS `fittedToShipId === Y` and nothing else.
//
// Scope note: 0.11.0 Task 20 layered the "a live slot is never empty" invariant onto
// unfitEquipment, it now evicts the occupant to the pool AND mints a fresh Standard-Issue
// into the slot (see the unfitEquipment describe block below). Fixtures replace the pool
// wholesale via withEquipment, so freshState's seeded baselines are not in play here
// except that freshState's nextEquipmentId (5, post-seed) is the id the auto-refit mints.
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
    iLevel: over.iLevel ?? 1,
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
// unfitEquipment: evict to the pool + auto-refit Standard-Issue (never-empty)
// ----------------------------------------------------------------------------
describe("unfitEquipment", () => {
  it("evicts a CRAFTED piece to the pool AND leaves a fresh Standard-Issue fitted (never empty)", () => {
    // A crafted (blueprintKey non-null) cargoBay piece fitted to ship-1.
    const crafted = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), crafted), nextEquipmentId: 42 };

    const next = unfitEquipment(state, "ship-1", "cargoBay");

    // The crafted piece is returned to the pool as a spare (player keeps their gear).
    const returned = next.equipment.find((e) => e.id === "equip-1");
    expect(returned?.fittedToShipId).toBeNull();
    expect(returned?.blueprintKey).toBe("prospectorHoldBp"); // unchanged, still the crafted piece

    // The slot is NOT empty: a fresh Standard-Issue baseline now occupies it.
    const fittedNow = equippedFor(next, "ship-1");
    expect(fittedNow).toHaveLength(1);
    expect(fittedNow[0].slotType).toBe("cargoBay");
    expect(fittedNow[0].blueprintKey).toBeNull(); // craft-less Standard-Issue
    expect(fittedNow[0].rarity).toBe("standard");
    expect(fittedNow[0].quality).toBe(0);
    expect(fittedNow[0].id).toBe("equip-42"); // minted from nextEquipmentId
    expect(next.nextEquipmentId).toBe(43); // counter advanced
  });

  it("unfitting a STANDARD-ISSUE slot leaves a Standard-Issue fitted (idempotent-ish: stat-identical, new id + spare)", () => {
    // The occupant is itself a Standard-Issue baseline (blueprintKey null).
    const baseline = makeEquip({ id: "equip-1", slotType: "ftlDrive", blueprintKey: null, fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), baseline), nextEquipmentId: 7 };

    const next = unfitEquipment(state, "ship-1", "ftlDrive");

    // The old baseline is in the pool; a fresh baseline (new id) holds the slot.
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    const fittedNow = equippedFor(next, "ship-1");
    expect(fittedNow).toHaveLength(1);
    expect(fittedNow[0].slotType).toBe("ftlDrive");
    expect(fittedNow[0].blueprintKey).toBeNull();
    expect(fittedNow[0].id).toBe("equip-7");
    expect(next.nextEquipmentId).toBe(8);
  });

  it("brings an ALREADY-EMPTY slot into the never-empty invariant by minting a Standard-Issue", () => {
    const state = { ...withEquipment(freshState()), nextEquipmentId: 3 }; // nothing fitted
    const next = unfitEquipment(state, "ship-1", "cargoBay");
    // No occupant to evict, but the slot must not be left empty -> a Standard-Issue is minted.
    const fittedNow = equippedFor(next, "ship-1");
    expect(fittedNow).toHaveLength(1);
    expect(fittedNow[0].slotType).toBe("cargoBay");
    expect(fittedNow[0].blueprintKey).toBeNull();
    expect(fittedNow[0].id).toBe("equip-3");
    expect(next.nextEquipmentId).toBe(4);
  });

  it("only unfits the named slot, leaving other fitted slots intact", () => {
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const drive = makeEquip({ id: "equip-2", slotType: "ftlDrive", fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), cargo, drive), nextEquipmentId: 50 };

    const next = unfitEquipment(state, "ship-1", "cargoBay");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull(); // evicted
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1"); // drive untouched
    // The cargoBay slot is auto-refit; the ftlDrive slot still holds equip-2. Two pieces fitted.
    expect(fittedInSlot(next, "ship-1", "cargoBay")?.blueprintKey).toBeNull(); // fresh Standard-Issue
    expect(fittedInSlot(next, "ship-1", "ftlDrive")?.id).toBe("equip-2");
  });
});
