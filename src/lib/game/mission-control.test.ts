// Mission-control facility tests — Mission Rework, Task 6
// (docs/plans/2026-07-14-mission-rework-plan.md Task 6 + design §2).
//
// Covers the completion-gated mission-unlock system:
//   - missionUnlocked(state, key): PURE level-derived predicate (tick.ts). Which
//     missions are dispatchable, as a function of missionControl's level only
//     (via MissionDef.unlockLevel -- no separate unlock flag).
//   - the requiresMissionCompletions prereq on the level-1 -> 2 mission-control
//     upgrade rung, enforced by the SAME generic canBuildFacilityUpgrade gate the
//     refinery/warehouse/fuel tracks use.
//   - the freshState seed (missionControl level 1) that keeps the ore runs available
//     from game start (the no-soft-lock / no-regression guarantee).
//   - the belt-and-suspenders dispatch guard in dispatchCaptainOnMission.
//
// These exercise the REAL FACILITIES.missionControl table (its finite 2-level
// track), not a synthetic def -- so the assertions double as a guard on that table.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  canBuildFacilityUpgrade,
  startFacilityUpgrade,
  resolveProcesses,
  missionUnlocked,
  dispatchCaptainOnMission,
} from "./tick";
import { freshState, FACILITIES, MISSION_CONTROL_UNLOCK_COMPLETIONS } from "./model";

describe("missionControl — fresh state seed + level-derived unlocks", () => {
  it("freshState seeds missionControl at level 1 (established from game start, no soft-lock)", () => {
    expect(freshState().facilities.missionControl).toEqual({ level: 1 });
  });

  it("the 2 ore runs are unlocked at the level-1 seed; Salvage + Forage are NOT", () => {
    const state = freshState(); // missionControl level 1
    // Ore runs (unlockLevel 1) -- available from the start, exactly as pre-rework.
    expect(missionUnlocked(state, "shortOreRun")).toBe(true);
    expect(missionUnlocked(state, "longOreRun")).toBe(true);
    // Salvage + Forage (unlockLevel 2) -- locked until the level-1 -> 2 upgrade.
    expect(missionUnlocked(state, "salvageWreckage")).toBe(false);
    expect(missionUnlocked(state, "forageFlora")).toBe(false);
  });

  it("at missionControl level 2, all four missions are unlocked (level derives the gate)", () => {
    const state = freshState();
    state.facilities = { ...state.facilities, missionControl: { level: 2 } };
    expect(missionUnlocked(state, "shortOreRun")).toBe(true);
    expect(missionUnlocked(state, "longOreRun")).toBe(true);
    expect(missionUnlocked(state, "salvageWreckage")).toBe(true);
    expect(missionUnlocked(state, "forageFlora")).toBe(true);
  });
});

describe("missionControl — the level-1 -> 2 upgrade is completion-gated", () => {
  // A fresh state (missionControl level 1) with ore stocked for the rung's cost and
  // a chosen completion count for each ore run. Everything the level-1 -> 2 upgrade
  // needs EXCEPT the completion counts, so those are the gate under test.
  function stateWithCompletions(shortDone: number, longDone: number) {
    const s = freshState();
    return {
      ...s,
      inventory: { ...s.inventory, commonOre: new Decimal(250) }, // the rung's material cost
      lifetimeStats: {
        ...s.lifetimeStats,
        missionsCompleted: {
          shortOreRun: new Decimal(shortDone),
          longOreRun: new Decimal(longDone),
        },
      },
    };
  }

  it("is BLOCKED when neither ore run has reached the completion threshold", () => {
    const state = stateWithCompletions(0, 0);
    const result = canBuildFacilityUpgrade(state, "missionControl");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/completions/);
  });

  it("is BLOCKED when only ONE ore run has reached the threshold (needs BOTH)", () => {
    const state = stateWithCompletions(MISSION_CONTROL_UNLOCK_COMPLETIONS, MISSION_CONTROL_UNLOCK_COMPLETIONS - 1);
    const result = canBuildFacilityUpgrade(state, "missionControl");
    expect(result.ok).toBe(false);
    // The still-short run (longOreRun) names the failing gate.
    expect(result.reason).toMatch(/Lunar Mine Contract/);
  });

  it("is ALLOWED once BOTH ore runs reach the completion threshold (materials also present)", () => {
    const state = stateWithCompletions(MISSION_CONTROL_UNLOCK_COMPLETIONS, MISSION_CONTROL_UNLOCK_COMPLETIONS);
    expect(canBuildFacilityUpgrade(state, "missionControl").ok).toBe(true);
  });

  it("still BLOCKS on materials if completions are met but the ore cost is short", () => {
    const state = stateWithCompletions(MISSION_CONTROL_UNLOCK_COMPLETIONS, MISSION_CONTROL_UNLOCK_COMPLETIONS);
    state.inventory = { ...state.inventory, commonOre: new Decimal(249) }; // needs 250
    const result = canBuildFacilityUpgrade(state, "missionControl");
    expect(result.ok).toBe(false);
    expect(result.reason).not.toMatch(/completions/); // completions passed; material is the wall now
  });
});

describe("missionControl — full upgrade flow to level 2 unlocks Salvage + Forage", () => {
  it("start the completion-gated upgrade, resolve it, and level 2 unlocks the two new missions", () => {
    const base = freshState();
    const state = {
      ...base,
      inventory: { ...base.inventory, commonOre: new Decimal(250) },
      lifetimeStats: {
        ...base.lifetimeStats,
        missionsCompleted: {
          shortOreRun: new Decimal(MISSION_CONTROL_UNLOCK_COMPLETIONS),
          longOreRun: new Decimal(MISSION_CONTROL_UNLOCK_COMPLETIONS),
        },
      },
    };

    // Salvage locked at level 1...
    expect(missionUnlocked(state, "salvageWreckage")).toBe(false);

    // Start the upgrade -> deducts the 250 ore, pushes the facilityUpgrade process.
    const started = startFacilityUpgrade(state, "missionControl");
    expect(started.started).toBe(true);
    expect(started.next.inventory.commonOre.toString()).toBe("0"); // cost deducted
    expect(started.next.facilities.missionControl.level).toBe(1); // not bumped until completion

    // Resolve the rung's full duration (60 ticks) -> level 1 -> 2, process cleared.
    const rungDuration = FACILITIES.missionControl.upgrades[1].durationTicks; // 60
    const resolved = resolveProcesses(started.next, rungDuration);
    expect(resolved.next.facilities.missionControl.level).toBe(2);
    expect(resolved.next.activeProcesses).toHaveLength(0);

    // ...and now Salvage + Forage are unlocked (level derived it, no flag).
    expect(missionUnlocked(resolved.next, "salvageWreckage")).toBe(true);
    expect(missionUnlocked(resolved.next, "forageFlora")).toBe(true);
  });
});

describe("missionControl — track caps at level 2 (no placeholder rungs)", () => {
  it("FACILITIES.missionControl has exactly 2 rungs (founding 0->1 + the real 1->2)", () => {
    expect(FACILITIES.missionControl.upgrades).toHaveLength(2);
  });

  it("a level-2 missionControl is fully upgraded (no next rung)", () => {
    const state = freshState();
    // Pile on resources + completions -- being maxed must override affordability.
    const maxed = {
      ...state,
      facilities: { ...state.facilities, missionControl: { level: 2 } },
      inventory: { ...state.inventory, commonOre: new Decimal(1e9) },
      lifetimeStats: {
        ...state.lifetimeStats,
        missionsCompleted: { shortOreRun: new Decimal(1e9), longOreRun: new Decimal(1e9) },
      },
    };
    const result = canBuildFacilityUpgrade(maxed, "missionControl");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fully upgraded/);
  });
});

describe("dispatchCaptainOnMission — belt-and-suspenders unlock guard (Task 6)", () => {
  it("blocks dispatch of a locked mission (Salvage at the level-1 seed), same-ref no-op", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000); // rule out the fuel gate -- isolate the unlock gate
    const { next, success } = dispatchCaptainOnMission(state, state.captains[0].id, "salvageWreckage");
    expect(success).toBe(false);
    expect(next).toBe(state); // same reference on failure
  });

  it("allows dispatch of a locked mission once missionControl reaches level 2", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000);
    state.facilities = { ...state.facilities, missionControl: { level: 2 } };
    // Task 7: Salvage now also requires captain level 2 (a modest capability gate on top
    // of the unlock). This test isolates the UNLOCK gate, so clear the new level gate by
    // bumping the fresh level-1 captain -- the Freighter's cargo 90 already meets salvage's
    // requiresCargoCapacity 90. (Requirement gates get their own coverage in
    // dispatch-requirements.test.ts.)
    state.captains[0] = { ...state.captains[0], level: 2 };
    const { success } = dispatchCaptainOnMission(state, state.captains[0].id, "salvageWreckage");
    expect(success).toBe(true);
  });

  it("still allows the ore runs at the fresh level-1 seed (no regression)", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000);
    const { success } = dispatchCaptainOnMission(state, state.captains[0].id, "shortOreRun");
    expect(success).toBe(true);
  });
});
