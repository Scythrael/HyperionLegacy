// Dispatch requirements + typed reasons tests — Mission Rework Task 7
// (docs/plans/2026-07-14-mission-rework-plan.md Task 7, design §4).
//
// Task 7 CONSOLIDATES the unlock gate (Task 6) and the fuel range/resource gates
// (Task 5) that dispatchCaptainOnMission grew inline, plus ADDS two per-mission
// capability requirements (captain level + ship cargo capacity), into ONE pure
// predicate: canDispatch(state, captainId, missionKey) -> { ok } | { ok, reason }.
// dispatchCaptainOnMission then becomes a thin wrapper over canDispatch (single
// source of truth) and exposes the block `reason` on its return for the UI (Task 8).
//
// These tests pin, for EACH unmet condition, the exact DispatchBlockReason returned,
// the "all met -> ok" happy path, and that the Task-5 fuel deduction + same-ref-on-
// failure contract still hold now that dispatch routes through canDispatch.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, MISSIONS, freshState } from "./model";
import { fuelNeeded } from "./fuel";
import { canDispatch, dispatchCaptainOnMission } from "./tick";

// freshState() seeds ONE captain (id 1, level 1) flying "ship-1" (General Freighter:
// cargoCapacity 90, fuelCapacity 200, engineEfficiency 0) with the tank at 0 fuel and
// missionControl at level 1. USER REVISION 2026-07-14: ALL FOUR missions are unlockLevel
// 1, so every mission is UNLOCKED at that seed -- Salvage/Forage are now gated only by
// their CAPABILITY requirements (captain level / cargo), NOT by the unlock. Every test
// below starts from that and mutates ONLY the field it is isolating. The `locked` reason
// (still a real code path for future higher-unlockLevel missions) is exercised by
// DROPPING missionControl below a mission's unlockLevel.
const FREIGHTER_SHORT_RUN_FUEL = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter); // 50

describe("canDispatch — happy path (all gates pass)", () => {
  it("returns { ok: true } for an unlocked, requirement-free, fuel-covered ore run", () => {
    const state = freshState();
    state.fuel = new Decimal(FREIGHTER_SHORT_RUN_FUEL); // exactly enough for one round trip
    expect(canDispatch(state, 1, "shortOreRun")).toEqual({ ok: true });
  });

  it("returns { ok: true } for a Salvage run once EVERY gate is satisfied", () => {
    const state = freshState(); // USER REVISION: Salvage is unlockLevel 1 -> already unlocked at the seed
    state.captains[0] = { ...state.captains[0], level: 5 }; // clear the captain-level capability gate
    state.fuel = new Decimal(1_000_000); // clear the fuel-resource gate
    // Freighter cargo 90 >= salvage's requiresCargoCapacity, fuelCapacity 200 >= need.
    expect(canDispatch(state, 1, "salvageWreckage")).toEqual({ ok: true });
  });
});

describe("canDispatch — one reason per unmet condition (gate order)", () => {
  it("noCaptain — no captain has that id", () => {
    const state = freshState();
    expect(canDispatch(state, 999, "shortOreRun")).toEqual({ ok: false, reason: "noCaptain" });
  });

  it("busy — the captain is already on a mission", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000);
    // Make the captain busy the REAL way -- dispatch them once -- so the mission's cargo
    // is a valid LootTotals record (hand-building `{}` would not type-check).
    const busy = dispatchCaptainOnMission(state, 1, "shortOreRun").next;
    expect(busy.captains[0].mission).not.toBe(null); // precondition: now on a mission
    expect(canDispatch(busy, 1, "shortOreRun")).toEqual({ ok: false, reason: "busy" });
  });

  it("locked — the mission's unlockLevel exceeds the missionControl level (checked before requirements)", () => {
    // USER REVISION: all four missions are unlockLevel 1, so nothing is locked at the
    // level-1 seed. The `locked` reason is still a live code path for future higher-
    // unlockLevel missions -- exercise it by DROPPING missionControl below the ore run's
    // unlockLevel 1. captain/fuel/cargo all pass, but `locked` is ordered FIRST.
    const state = freshState();
    state.facilities = { ...state.facilities, missionControl: { level: 0 } }; // < shortOreRun's unlockLevel 1
    state.fuel = new Decimal(1_000_000); // rule out fuel gates
    expect(canDispatch(state, 1, "shortOreRun")).toEqual({ ok: false, reason: "locked" });
  });

  it("captainLevel — mission unlocked but the captain is below requiresCaptainLevel", () => {
    const state = freshState(); // Salvage unlocked at the level-1 seed (unlockLevel 1)
    state.fuel = new Decimal(1_000_000); // rule out fuel gates
    // captain still level 1, below Salvage's requiresCaptainLevel (a kept CAPABILITY gate).
    expect(canDispatch(state, 1, "salvageWreckage")).toEqual({ ok: false, reason: "captainLevel" });
  });

  it("cargo — captain level met but the ship's cargoCapacity is below requiresCargoCapacity", () => {
    const state = freshState(); // Salvage unlocked at the level-1 seed
    state.captains[0] = { ...state.captains[0], level: 5 }; // clear captain-level gate
    state.fuel = new Decimal(1_000_000); // clear fuel gates
    state.ships = [{ id: "ship-1", typeKey: "prospectorRunner", assignedCaptainId: 1 }]; // Runner cargo 60 < 90
    expect(canDispatch(state, 1, "salvageWreckage")).toEqual({ ok: false, reason: "cargo" });
  });

  it("noShip — the captain has no assigned hull to price/carry the trip", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000);
    state.ships = []; // captain 1 now flies nothing
    expect(canDispatch(state, 1, "shortOreRun")).toEqual({ ok: false, reason: "noShip" });
  });

  it("fuelCapacity — the hull's tank is physically too small for one round trip (RANGE)", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000); // plenty in the shared tank -> isolate RANGE from RESOURCE
    const need = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter);
    const originalCap = SHIP_TYPES.generalFreighter.fuelCapacity;
    try {
      SHIP_TYPES.generalFreighter.fuelCapacity = Math.floor(need) - 1; // tank can't hold one trip
      expect(canDispatch(state, 1, "shortOreRun")).toEqual({ ok: false, reason: "fuelCapacity" });
    } finally {
      SHIP_TYPES.generalFreighter.fuelCapacity = originalCap; // restore the shared table
    }
  });

  it("fuelEmpty — hull can range it but the shared tank is too low (RESOURCE)", () => {
    const state = freshState(); // fuel seeds to 0
    expect(canDispatch(state, 1, "shortOreRun")).toEqual({ ok: false, reason: "fuelEmpty" });
  });
});

describe("dispatchCaptainOnMission — consumes canDispatch (reason exposed + fuel deduction intact)", () => {
  it("on a CLEAN dispatch: success, no reason, and the Task-5 fuel deduction still fires", () => {
    const state = freshState();
    state.fuel = new Decimal(100);
    const { next, success, reason } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(true);
    expect(reason).toBeUndefined();
    expect(next.captains[0].mission?.missionKey).toBe("shortOreRun");
    expect(next.fuel.eq(100 - FREIGHTER_SHORT_RUN_FUEL)).toBe(true); // 50 spent at dispatch
  });

  it("on a BLOCK: success false, same state ref, and the canDispatch reason is surfaced", () => {
    const state = freshState(); // 0 fuel -> fuelEmpty
    const { next, success, reason } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(false);
    expect(next).toBe(state); // same-ref no-op preserved
    expect(reason).toBe("fuelEmpty");
    expect(next.captains[0].mission).toBe(null);
  });

  it("surfaces the `locked` reason (Task-6 unlock gate still fires via canDispatch)", () => {
    // USER REVISION: no mission is locked at the level-1 seed, so drop missionControl
    // below the ore run's unlockLevel 1 to trigger the still-live `locked` code path.
    const state = freshState();
    state.facilities = { ...state.facilities, missionControl: { level: 0 } };
    state.fuel = new Decimal(1_000_000);
    const { success, reason } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(false);
    expect(reason).toBe("locked");
  });
});
