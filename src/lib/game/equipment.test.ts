// ============================================================================
// Equipment 0.11.0 (Task 12): fit / unfit SYSTEM tests.
// Author: Scythrael (via Claude) | 2026-07-17
//
// Covers the pure state-transform helpers in equipment.ts:
//   - equippedFor / fittedInSlot  (queries over the fittedToShipId authority)
//   - canFitEquipment             (the fitment gate + typed block reasons)
//   - fitEquipment                (ADD for a multi weapon slot / atomic swap for a singleton)
//   - unfitEquipment              (economy: evict to the pool + auto-refit Standard-Issue)
//   - unfitEquipmentInstance      (uninstall by id: economy never-empty / combat allow-empty)
//
// Combat 1.0 (Unit 1.8a) adds the combat-gear fit logic: weapon is a MULTI slot (fills the hull's
// hardpoints, install ADDS, over-cap blocks with hardpointsFull); shieldEmitters + hullPlating are
// singletons; combat slots ALLOW EMPTY on uninstall (no Standard-Issue re-fit) so the dispatch
// blocker is reachable, while ECONOMY slots stay never-empty. See the last describe block.
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
  unfitEquipmentInstance,
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
    kind: "extraction" as const,
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
    // The displaced piece is CRAFTED (blueprintKey non-null): a crafted occupant is real, recoverable
    // inventory, so the swap evicts it to the pool. (A displaced Standard-Issue BASELINE is instead
    // DESTROYED, covered by its own test below.)
    const first = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: "ship-1" }); // already in the cargo slot
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
    // Displaced cargo piece is CRAFTED so the swap evicts it to the pool (see the note above); the
    // test's concern is slot isolation, not the baseline-destroy path.
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: "ship-1" });
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

  it("EVICTS a displaced ECONOMY Standard-Issue baseline to the pool (never destroys it, no auto-delete)", () => {
    // Installing a crafted economy piece over a Standard-Issue baseline must EVICT the baseline to the
    // spare pool, NEVER destroy it. Destroying it made the free floor "vanish into thin air" on a swap,
    // which reads as data loss even for a worthless +0 piece (user principle: no auto-delete, ever).
    // Dupe-safe because uninstall never re-mints: the displaced baseline just moves fitted -> pool.
    const baseline = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: null, fittedToShipId: "ship-1" }); // the floor
    const crafted = makeEquip({ id: "equip-2", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: null }); // spare to install
    const state = withEquipment(freshState(), baseline, crafted);

    const next = fitEquipment(state, "ship-1", "equip-2");

    // The baseline SURVIVES, evicted to the pool (recoverable spare), not destroyed:
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    // The crafted piece is the sole occupant of the cargo slot:
    expect(equippedFor(next, "ship-1").map((e) => e.id)).toEqual(["equip-2"]);
    // Net item count unchanged: 2 -> 2 (nothing deleted, the baseline is now a spare).
    expect(next.equipment).toHaveLength(2);
  });

  it("does NOT destroy a displaced DEV/valuable null-blueprint economy piece (only a genuine baseline is dropped)", () => {
    // REGRESSION (reported data loss): a dev-granted item (devGrantEquipment) is minted blueprintKey
    // null but RADIANT iL 400. It is NOT a Standard-Issue floor, so installing a crafted piece over it
    // must EVICT it to the pool (recoverable), never destroy it. The destroy path uses the strict
    // isStandardIssueBaseline predicate (blueprintKey null AND rarity "standard"), which a radiant dev
    // item can never match, so it survives.
    const devItem = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: null, rarity: "radiant", iLevel: 400, quality: 5, fittedToShipId: "ship-1" });
    const crafted = makeEquip({ id: "equip-2", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: null });
    const state = withEquipment(freshState(), devItem, crafted);

    const next = fitEquipment(state, "ship-1", "equip-2");

    // The dev item SURVIVES, evicted to the pool (not destroyed):
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(next.equipment.find((e) => e.id === "equip-1")?.rarity).toBe("radiant");
    expect(next.equipment).toHaveLength(2); // both pieces present, nothing deleted
    expect(equippedFor(next, "ship-1").map((e) => e.id)).toEqual(["equip-2"]); // crafted now fitted
  });

  it("does NOT destroy a displaced COMBAT baseline (combat slots are allow-empty, their baselines are recoverable)", () => {
    // A shieldEmitters baseline is a real, re-installable spare on the allow-empty combat slots, so a
    // swap must EVICT it to the pool, never destroy it (unlike the economy floor above).
    const combatBaseline = makeEquip({ id: "equip-1", slotType: "shieldEmitters", blueprintKey: null, fittedToShipId: "ship-1" });
    const fresh = makeEquip({ id: "equip-2", slotType: "shieldEmitters", blueprintKey: "hardenedShieldBp", rarity: "radiant", fittedToShipId: null });
    const state = withHull(withEquipment(freshState(), combatBaseline, fresh), "destroyer");

    const next = fitEquipment(state, "ship-1", "equip-2");

    // The combat baseline is EVICTED (still present, now a spare), not destroyed:
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(next.equipment).toHaveLength(2);
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
// Combat 1.0 (Unit 1.8a): canFitEquipment now OPENS the three combat slots to player install
// (Unit 1.3 rejected them while only the auto-installed baseline existed). Reserved/unknown slots
// are still rejected generically (slotNotInstallable); the combatSlotNotInstallable reason is gone.
describe("canFitEquipment opens the combat slots (Combat 1.0, Unit 1.8a)", () => {
  for (const slotType of ["weapon", "shieldEmitters", "hullPlating"] as const) {
    it(`ALLOWS a spare combat ${slotType} piece on a combat hull`, () => {
      // A destroyer (combat hull, 4 hardpoints) with a spare combat piece in the pool: now installable.
      const piece = makeEquip({ id: "equip-1", slotType, fittedToShipId: null });
      const state = withHull(withEquipment(freshState(), piece), "destroyer");
      expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: true });
    });
  }

  it("rejects a reserved/unknown slot (bridge) with slotNotInstallable", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "bridge" as EquipmentSlotType, fittedToShipId: null });
    const state = withEquipment(freshState(), piece);
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: false, reason: "slotNotInstallable" });
  });

  it("still ALLOWS an economy slot (the guard only blocks reserved/unknown slots)", () => {
    const piece = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: null });
    const state = withEquipment(freshState(), piece);
    expect(canFitEquipment(state, "ship-1", "equip-1")).toEqual({ ok: true });
  });
});

describe("drone-bay MULTI slot capacity (Combat 1.0, Unit 2.2)", () => {
  // A carrier has SHIP_TYPES.carrier.droneBays = 2 bays; a destroyer has none (droneBays absent -> 0).
  function pod(id: string, fittedToShipId: string | null): EquipmentInstance {
    return makeEquip({ id, slotType: "droneBay", droneRole: "attack", fittedToShipId });
  }

  it("installs pods onto a carrier up to the bay cap, blocking the (cap+1)th with baysFull", () => {
    let state = withHull(
      withEquipment(freshState(), pod("pod-1", null), pod("pod-2", null), pod("pod-3", null)),
      "carrier",
    );
    expect(canFitEquipment(state, "ship-1", "pod-1")).toEqual({ ok: true });
    state = fitEquipment(state, "ship-1", "pod-1");
    expect(canFitEquipment(state, "ship-1", "pod-2")).toEqual({ ok: true });
    state = fitEquipment(state, "ship-1", "pod-2");
    // Both bays now full (2 >= 2): the third is blocked.
    expect(canFitEquipment(state, "ship-1", "pod-3")).toEqual({ ok: false, reason: "baysFull" });
  });

  it("blocks a pod on a hull with no bays (destroyer, droneBays 0)", () => {
    const state = withHull(withEquipment(freshState(), pod("pod-1", null)), "destroyer");
    expect(canFitEquipment(state, "ship-1", "pod-1")).toEqual({ ok: false, reason: "baysFull" });
  });

  it("ADDS pods (MULTI slot), never evicting a sibling", () => {
    let state = withHull(withEquipment(freshState(), pod("pod-1", null), pod("pod-2", null)), "carrier");
    state = fitEquipment(state, "ship-1", "pod-1");
    state = fitEquipment(state, "ship-1", "pod-2");
    const fitted = state.equipment.filter((e) => e.fittedToShipId === "ship-1" && e.slotType === "droneBay");
    expect(fitted.map((e) => e.id).sort()).toEqual(["pod-1", "pod-2"]);
  });

  it("uninstalls a specific pod, leaving the bay empty (allow-empty, no baseline restore)", () => {
    let state = withHull(withEquipment(freshState(), pod("pod-1", "ship-1"), pod("pod-2", "ship-1")), "carrier");
    state = unfitEquipmentInstance(state, "ship-1", "pod-1");
    const fitted = state.equipment.filter((e) => e.fittedToShipId === "ship-1" && e.slotType === "droneBay");
    expect(fitted.map((e) => e.id)).toEqual(["pod-2"]);
    expect(state.equipment.find((e) => e.id === "pod-1")?.fittedToShipId).toBeNull(); // now a spare
  });

  it("a re-install check of an already-fitted pod is not miscounted against the cap", () => {
    const state = withHull(withEquipment(freshState(), pod("pod-1", "ship-1"), pod("pod-2", "ship-1")), "carrier");
    // Both bays occupied, but re-checking pod-1 (already fitted) excludes itself, so it is still ok.
    expect(canFitEquipment(state, "ship-1", "pod-1")).toEqual({ ok: true });
  });
});

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

  it("unfitting a STANDARD-ISSUE baseline is a NO-OP (never creates an extra baseline)", () => {
    // The occupant is itself a Standard-Issue baseline (blueprintKey null): the free slot FLOOR, not
    // collectible inventory. Uninstalling it must NOT evict it to the pool and must NOT mint a
    // replacement (the old behavior did both, net-creating one baseline per call, the duplication bug).
    const baseline = makeEquip({ id: "equip-1", slotType: "ftlDrive", blueprintKey: null, fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), baseline), nextEquipmentId: 7 };

    const next = unfitEquipment(state, "ship-1", "ftlDrive");

    // The SAME baseline stays fitted; nothing pooled, nothing minted, counter untouched.
    expect(next.equipment).toHaveLength(1);
    const fittedNow = equippedFor(next, "ship-1");
    expect(fittedNow).toHaveLength(1);
    expect(fittedNow[0].id).toBe("equip-1"); // same instance, not a fresh mint
    expect(fittedNow[0].slotType).toBe("ftlDrive");
    expect(fittedNow[0].blueprintKey).toBeNull();
    expect(next.nextEquipmentId).toBe(7); // counter did NOT advance
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
    // Cargo occupant is CRAFTED so unfitting it exercises the real evict-and-refit path (a baseline
    // occupant would be a no-op); the test's concern is slot isolation of the ftlDrive piece.
    const cargo = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: "ship-1" });
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

// ----------------------------------------------------------------------------
// Combat gear fit logic (Combat 1.0, Unit 1.8a)
// ----------------------------------------------------------------------------
// weapon is a MULTI slot: install ADDS to the hull's hardpoints; over-cap blocks with
// hardpointsFull. shieldEmitters + hullPlating are singletons (install replaces). Uninstall
// is BY INSTANCE id and combat slots ALLOW EMPTY (no Standard-Issue re-fit), while economy
// slots stay never-empty even through the instance path.

describe("combat weapon: MULTI slot install (add, not swap)", () => {
  it("installing a weapon ADDS it and does NOT evict a sibling weapon", () => {
    const w1 = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: "ship-1" }); // already mounted
    const w2 = makeEquip({ id: "equip-2", slotType: "weapon", fittedToShipId: null }); // spare
    const state = withHull(withEquipment(freshState(), w1, w2), "destroyer"); // 4 hardpoints

    const next = fitEquipment(state, "ship-1", "equip-2");

    // BOTH weapons are mounted (add, not the singleton swap):
    const mounted = equippedFor(next, "ship-1").filter((e) => e.slotType === "weapon");
    expect(mounted.map((e) => e.id).sort()).toEqual(["equip-1", "equip-2"]);
  });

  it("ALLOWS filling the last open hardpoint (under the cap)", () => {
    // Carrier: 2 hardpoints, one already mounted -> a second spare still fits.
    const w1 = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: "ship-1" });
    const w2 = makeEquip({ id: "equip-2", slotType: "weapon", fittedToShipId: null });
    const state = withHull(withEquipment(freshState(), w1, w2), "carrier");
    expect(canFitEquipment(state, "ship-1", "equip-2")).toEqual({ ok: true });
  });

  it("blocks the (cap+1)th weapon with hardpointsFull (gate + throw)", () => {
    // Carrier: 2 hardpoints. Fill both, then a third spare is refused.
    const w1 = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: "ship-1" });
    const w2 = makeEquip({ id: "equip-2", slotType: "weapon", fittedToShipId: "ship-1" });
    const w3 = makeEquip({ id: "equip-3", slotType: "weapon", fittedToShipId: null }); // over cap
    const state = withHull(withEquipment(freshState(), w1, w2, w3), "carrier");

    expect(equippedFor(state, "ship-1").filter((e) => e.slotType === "weapon")).toHaveLength(2);
    expect(canFitEquipment(state, "ship-1", "equip-3")).toEqual({ ok: false, reason: "hardpointsFull" });
    expect(() => fitEquipment(state, "ship-1", "equip-3")).toThrow(/hardpointsFull/);
  });
});

describe("combat shield/plating: SINGLETON install (replace)", () => {
  it("installing a shield emitter REPLACES the current one (evicts it to the pool)", () => {
    const old = makeEquip({ id: "equip-1", slotType: "shieldEmitters", fittedToShipId: "ship-1" });
    const fresh = makeEquip({ id: "equip-2", slotType: "shieldEmitters", fittedToShipId: null });
    const state = withHull(withEquipment(freshState(), old, fresh), "destroyer");

    const next = fitEquipment(state, "ship-1", "equip-2");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull(); // evicted
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1");
    // Exactly one emitter fitted (singleton, not additive):
    const inSlot = equippedFor(next, "ship-1").filter((e) => e.slotType === "shieldEmitters");
    expect(inSlot.map((e) => e.id)).toEqual(["equip-2"]);
  });

  it("installing hull plating REPLACES the current plating (singleton)", () => {
    const old = makeEquip({ id: "equip-1", slotType: "hullPlating", fittedToShipId: "ship-1" });
    const fresh = makeEquip({ id: "equip-2", slotType: "hullPlating", fittedToShipId: null });
    const state = withHull(withEquipment(freshState(), old, fresh), "destroyer");

    const next = fitEquipment(state, "ship-1", "equip-2");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    const inSlot = equippedFor(next, "ship-1").filter((e) => e.slotType === "hullPlating");
    expect(inSlot.map((e) => e.id)).toEqual(["equip-2"]);
  });
});

describe("combat gear: ALLOW-EMPTY uninstall (unfitEquipmentInstance)", () => {
  it("uninstalling a specific weapon leaves the OTHER weapons mounted, mints NO baseline", () => {
    const w1 = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: "ship-1" });
    const w2 = makeEquip({ id: "equip-2", slotType: "weapon", fittedToShipId: "ship-1" });
    const state = withHull(withEquipment(freshState(), w1, w2), "destroyer");

    const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull(); // spare now
    expect(next.equipment.find((e) => e.id === "equip-2")?.fittedToShipId).toBe("ship-1"); // stays mounted
    expect(equippedFor(next, "ship-1").map((e) => e.id)).toEqual(["equip-2"]);
    expect(next.equipment).toHaveLength(2); // nothing minted (allow-empty)
    expect(next.nextEquipmentId).toBe(state.nextEquipmentId); // counter untouched
  });

  it("uninstalling a required combat slot leaves it EMPTY (the dispatch blocker becomes reachable)", () => {
    // The sole shield emitter, uninstalled: unlike an economy slot, NOTHING refills it.
    const shield = makeEquip({ id: "equip-1", slotType: "shieldEmitters", fittedToShipId: "ship-1" });
    const state = withHull(withEquipment(freshState(), shield), "destroyer");

    const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    // The slot is EMPTY. (Combat-defense rework, Unit 3: an empty shield emitter no longer blocks
    // dispatch. It just means 0 shields, a silent player choice; the reactor is the only hard block.)
    expect(fittedInSlot(next, "ship-1", "shieldEmitters")).toBeNull();
    expect(equippedFor(next, "ship-1")).toHaveLength(0);
    expect(next.nextEquipmentId).toBe(state.nextEquipmentId); // no mint
  });

  it("uninstalling the LAST weapon leaves the hull with zero weapons", () => {
    const w1 = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: "ship-1" });
    const state = withHull(withEquipment(freshState(), w1), "destroyer");

    const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

    expect(equippedFor(next, "ship-1").filter((e) => e.slotType === "weapon")).toHaveLength(0);
  });
});

describe("unfitEquipmentInstance: economy is now ALLOW-EMPTY + guards", () => {
  it("uninstalling a CRAFTED economy piece pools it and leaves the slot EMPTY (no baseline minted)", () => {
    const crafted = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), crafted), nextEquipmentId: 42 };

    const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

    // Crafted piece returns to the pool; the slot is left EMPTY (allow-empty, nothing minted). An
    // empty economy slot is economically identical to the old Standard-Issue baseline (both +0).
    expect(next.equipment.find((e) => e.id === "equip-1")?.fittedToShipId).toBeNull();
    expect(equippedFor(next, "ship-1")).toHaveLength(0);
    expect(next.equipment).toHaveLength(1); // just the pooled crafted spare, no baseline
    expect(next.nextEquipmentId).toBe(42); // counter untouched (no mint)
  });

  it("throws on the on-mission lock", () => {
    const fitted = makeEquip({ id: "equip-1", slotType: "cargoBay", fittedToShipId: "ship-1" });
    const state = withCaptainOnMission(withEquipment(freshState(), fitted));
    expect(() => unfitEquipmentInstance(state, "ship-1", "equip-1")).toThrow(/onMission/);
  });

  it("throws for an unknown instance id (noInstance)", () => {
    const state = withHull(withEquipment(freshState()), "destroyer"); // empty pool
    expect(() => unfitEquipmentInstance(state, "ship-1", "equip-nope")).toThrow(/noInstance/);
  });

  it("throws when the instance is not installed on the target ship (stale/bad call)", () => {
    const spare = makeEquip({ id: "equip-1", slotType: "weapon", fittedToShipId: null }); // spare, not on ship
    const state = withHull(withEquipment(freshState(), spare), "destroyer");
    expect(() => unfitEquipmentInstance(state, "ship-1", "equip-1")).toThrow(/not installed/);
  });
});

// ----------------------------------------------------------------------------
// INTEGRITY + RECOVERABILITY: uninstalling an economy slot must NEVER net-create an item
// (the reported dupe) AND must never LOSE the piece (the reported "nowhere to be found").
// Economy slots are ALLOW-EMPTY and UNIFORM with combat: every uninstall POOLS the piece
// (baseline or crafted) as a re-installable spare and leaves the slot empty. No branch mints
// (so no dupe) and no branch destroys (so nothing vanishes).
// ----------------------------------------------------------------------------
describe("economy uninstall pools the piece (integrity + recoverability)", () => {
  // Tapping Uninstall on a Standard-Issue baseline used to evict it to the pool AND mint a fresh one
  // (1 -> 2), repeatable forever. It now just POOLS the one baseline: count stays 1, slot empties, and
  // the baseline is a recoverable spare (fittedToShipId null) that the install picker will re-offer.
  it("uninstalling an economy Standard-Issue baseline POOLS it (count stays 1, slot empty, recoverable)", () => {
    const baseline = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: null, fittedToShipId: "ship-1" });
    const state = { ...withEquipment(freshState(), baseline), nextEquipmentId: 50 };

    const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

    expect(next.equipment).toHaveLength(1); // no dupe AND no vanish: still exactly one item
    expect(next.equipment[0].id).toBe("equip-1"); // the SAME baseline instance
    expect(next.equipment[0].fittedToShipId).toBeNull(); // now a spare in the pool
    expect(equippedFor(next, "ship-1")).toHaveLength(0); // slot empty
    expect(next.nextEquipmentId).toBe(50); // nothing minted
  });

  // The exact bug the user hit: uninstall a baseline, then be unable to find it to re-install. Prove
  // the pooled baseline is re-installable back into its (now empty) slot.
  it("a uninstalled economy baseline can be RE-INSTALLED from the pool (recoverability)", () => {
    const baseline = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: null, fittedToShipId: "ship-1" });
    const state = withHull({ ...withEquipment(freshState(), baseline), nextEquipmentId: 50 }, "destroyer");

    const emptied = unfitEquipmentInstance(state, "ship-1", "equip-1");
    expect(fittedInSlot(emptied, "ship-1", "cargoBay")).toBeNull(); // slot empty
    // It is a spare of the right slotType, so canFitEquipment accepts it and fitEquipment re-installs it.
    expect(canFitEquipment(emptied, "ship-1", "equip-1").ok).toBe(true);
    const refitted = fitEquipment(emptied, "ship-1", "equip-1");
    expect(fittedInSlot(refitted, "ship-1", "cargoBay")?.id).toBe("equip-1"); // back in the slot
    expect(refitted.equipment).toHaveLength(1); // still exactly one item across the round-trip
  });

  // Install a crafted economy piece over a baseline, then uninstall it. NOTHING is destroyed and NOTHING
  // is minted: the displaced baseline pools on install, the crafted pools on uninstall, so the item
  // count is CONSTANT across the whole round-trip (no dupe AND no vanish). Both end as recoverable spares.
  it("crafted economy install-then-uninstall over a baseline is item-count-neutral (no dupe, no vanish)", () => {
    const baseline = makeEquip({ id: "equip-1", slotType: "cargoBay", blueprintKey: null, fittedToShipId: "ship-1" }); // the slot floor
    const crafted = makeEquip({ id: "equip-2", slotType: "cargoBay", blueprintKey: "prospectorHoldBp", rarity: "radiant", fittedToShipId: null }); // player's gear, a spare
    const before: GameState = { ...withEquipment(freshState(), baseline, crafted), nextEquipmentId: 100 };
    const countBefore = before.equipment.length; // 2

    // Install the crafted piece (baseline pools, not destroyed), then uninstall it.
    const installed = fitEquipment(before, "ship-1", "equip-2");
    const after = unfitEquipmentInstance(installed, "ship-1", "equip-2");

    // The crafted piece is present and back in the pool (unfitted):
    const craftedAfter = after.equipment.find((e) => e.id === "equip-2");
    expect(craftedAfter?.fittedToShipId).toBeNull();
    expect(craftedAfter?.blueprintKey).toBe("prospectorHoldBp");

    // The displaced baseline also SURVIVES as a recoverable spare (never destroyed):
    const baselineAfter = after.equipment.find((e) => e.id === "equip-1");
    expect(baselineAfter?.fittedToShipId).toBeNull();

    // The slot is EMPTY (allow-empty: no baseline auto-restored into it):
    expect(equippedFor(after, "ship-1")).toHaveLength(0);

    // Count is EXACTLY constant: no dupe (never grows), no vanish (never shrinks). Both pieces are spares.
    expect(after.equipment).toHaveLength(countBefore); // 2 in, 2 out
  });

  // The allow-empty pool lives in generic uninstall code (any slotType), so ftl/reactor/spec are
  // covered the same as cargoBay. Prove the baseline pools (not vanishes) for all four economy slots.
  for (const slotType of ["cargoBay", "ftlDrive", "reactorCore", "specUtility"] as const) {
    it(`baseline uninstall pools the free floor for the ${slotType} economy slot too`, () => {
      const baseline = makeEquip({ id: "equip-1", slotType, blueprintKey: null, fittedToShipId: "ship-1" });
      const state = { ...withEquipment(freshState(), baseline), nextEquipmentId: 77 };

      const next = unfitEquipmentInstance(state, "ship-1", "equip-1");

      expect(next.equipment).toHaveLength(1); // pooled, not destroyed
      expect(next.equipment[0].fittedToShipId).toBeNull(); // recoverable spare
      expect(equippedFor(next, "ship-1")).toHaveLength(0); // slot empty
      expect(next.nextEquipmentId).toBe(77);
    });
  }
});
