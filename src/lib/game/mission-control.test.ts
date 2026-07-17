// Mission-control facility tests, Mission Rework, Task 6
// (docs/plans/2026-07-14-mission-rework-plan.md Task 6 + design §2),
// REVISED 2026-07-14 (USER REVISION: all 4 missions default; unlock upgrade deferred).
//
// Covers the mission-unlock system after the revision:
//   - missionUnlocked(state, key): PURE level-derived predicate (tick.ts). ALL FOUR
//     current missions are unlockLevel 1, so every mission is dispatchable at the
//     level-1 seed, nothing is locked by default.
//   - the mission-control track now CAPS at level 1 (a lone founding rung). The
//     completion-gated level-1 -> 2 unlock UPGRADE is DEFERRED (removed) because
//     Salvage/Forage are now default and there is no 5th+ mission for a live rung to
//     unlock, a live rung unlocking nothing would be a placeholder.
//   - the requiresMissionCompletions prereq MECHANISM is RETAINED and still enforced
//     by the generic canBuildFacilityUpgrade gate, proven here via a test-only
//     fixture facility, so re-adding an unlock rung when future missions land is a
//     pure data change (no engine work).
//   - the freshState seed (missionControl level 1) that keeps every mission available
//     from game start (the no-soft-lock / no-regression guarantee).
//   - the belt-and-suspenders dispatch guard in dispatchCaptainOnMission (retained for
//     future higher-unlockLevel missions).
//
// These exercise the REAL FACILITIES.missionControl table (its finite 1-level track),
// not a synthetic def (except the reserved-mechanism fixture, which is clearly marked)
//, so the assertions double as a guard on that table.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Decimal from "break_infinity.js";
import {
  canBuildFacilityUpgrade,
  missionUnlocked,
  dispatchCaptainOnMission,
} from "./tick";
import { freshState, FACILITIES } from "./model";

describe("missionControl, fresh state seed + level-derived unlocks (USER REVISION: all 4 default)", () => {
  it("freshState seeds missionControl at level 1 (established from game start, no soft-lock)", () => {
    expect(freshState().facilities.missionControl).toEqual({ level: 1 });
  });

  it("ALL FOUR missions are unlocked at the level-1 seed (nothing is locked by default)", () => {
    const state = freshState(); // missionControl level 1
    for (const key of ["shortOreRun", "longOreRun", "salvageWreckage", "forageFlora"] as const) {
      expect(missionUnlocked(state, key), key).toBe(true);
    }
  });
});

describe("missionControl, track caps at level 1 (unlock UPGRADE deferred, no placeholder rung)", () => {
  it("FACILITIES.missionControl has exactly 1 rung (the lone founding rung, no live unlock rung)", () => {
    expect(FACILITIES.missionControl.upgrades).toHaveLength(1);
  });

  it("no mission-control rung declares requiresMissionCompletions (the completion-gated unlock is deferred)", () => {
    for (const rung of FACILITIES.missionControl.upgrades) {
      expect(rung.requiresMissionCompletions).toBeUndefined();
    }
  });

  it("a level-1 missionControl is fully upgraded (no next rung, caps at current content)", () => {
    const state = freshState(); // level 1 == the seed
    const result = canBuildFacilityUpgrade(state, "missionControl");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/fully upgraded/);
  });
});

describe("requiresMissionCompletions, RESERVED prereq mechanism stays enforced (for future unlock rungs)", () => {
  // The mission-control unlock UPGRADE was deferred (USER REVISION 2026-07-14), so NO
  // production rung uses requiresMissionCompletions today. But the prereq TYPE
  // (FacilityUpgradeDef.requiresMissionCompletions) and its enforcement in the generic
  // canBuildFacilityUpgrade gate (tick.ts) must stay working, so re-adding a completion-
  // gated rung when future missions land is a pure DATA change with no engine work.
  //
  // We prove that by injecting a TEST-ONLY fixture facility into the FACILITIES registry
  // whose single (level 0 -> 1) rung carries a completion gate, then asserting the gate
  // blocks/allows as the lifetime completion count crosses its threshold. The fixture is
  // removed after each test so it never leaks into other suites' view of FACILITIES.
  const FIXTURE_KEY = "__test_missionCompletionGate";
  const THRESHOLD = 3;

  beforeEach(() => {
    FACILITIES[FIXTURE_KEY] = {
      label: "Test Completion Gate",
      upgrades: [
        {
          materials: {}, // no material wall, isolate the completion gate
          durationTicks: 0,
          effect: { unlocksContent: true },
          requiresMissionCompletions: { shortOreRun: THRESHOLD },
        },
      ],
    };
  });

  afterEach(() => {
    delete FACILITIES[FIXTURE_KEY];
  });

  it("BLOCKS the rung when the mission's lifetime completion count is below threshold", () => {
    const state = freshState(); // fixture absent from state.facilities -> level 0 -> next rung is upgrades[0]
    state.lifetimeStats = {
      ...state.lifetimeStats,
      missionsCompleted: { shortOreRun: new Decimal(THRESHOLD - 1) },
    };
    const result = canBuildFacilityUpgrade(state, FIXTURE_KEY);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/completions/);
  });

  it("ALLOWS the rung once the completion count reaches threshold (mechanism intact)", () => {
    const state = freshState();
    state.lifetimeStats = {
      ...state.lifetimeStats,
      missionsCompleted: { shortOreRun: new Decimal(THRESHOLD) },
    };
    expect(canBuildFacilityUpgrade(state, FIXTURE_KEY).ok).toBe(true);
  });
});

describe("dispatchCaptainOnMission, belt-and-suspenders unlock guard (retained for future locked missions)", () => {
  it("all four missions dispatch at the fresh level-1 seed (capability gates cleared)", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000); // rule out the fuel gate, isolate the unlock gate
    // Salvage/Forage carry CAPABILITY gates (captain level 2/3) that are SEPARATE from the
    // unlock and deliberately kept, bump the captain past them so this test isolates the
    // UNLOCK behavior (that all four are unlockLevel 1). The Freighter's cargo 90 already
    // meets salvage/forage's requiresCargoCapacity 90.
    state.captains[0] = { ...state.captains[0], level: 5 };
    for (const key of ["shortOreRun", "longOreRun", "salvageWreckage", "forageFlora"] as const) {
      // Each call reads the SAME idle `state` (dispatch is pure, returns a new `next`,
      // never mutates `state`), so the captain stays idle across the loop.
      const { success } = dispatchCaptainOnMission(state, state.captains[0].id, key);
      expect(success, key).toBe(true);
    }
  });

  it("still BLOCKS a mission whose unlockLevel exceeds the facility level (guard mechanism intact)", () => {
    const state = freshState();
    state.fuel = new Decimal(1_000_000);
    // Drop missionControl BELOW the ore runs' unlockLevel 1 -> they become locked, exercising
    // the exact missionUnlocked guard a FUTURE higher-unlockLevel mission (paired with a
    // re-added unlock rung) will hit. This proves the level-derived lock path still works
    // even though no CURRENT mission triggers it.
    state.facilities = { ...state.facilities, missionControl: { level: 0 } };
    const { next, success, reason } = dispatchCaptainOnMission(state, state.captains[0].id, "shortOreRun");
    expect(success).toBe(false);
    expect(reason).toBe("locked");
    expect(next).toBe(state); // same reference on failure
  });
});
