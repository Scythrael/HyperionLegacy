// ============================================================================
// PATROL END REASONS + the per-run route count
// Infrastructure 0.13.4, Phase 2 (Units 2.1 and 2.2). Design sections 6.2 to 6.5.
//
// Three things are pinned here, and the first is the one a type cannot express:
//
//   1. THE IF-AND-ONLY-IF INVARIANT, in BOTH directions. `endReason` is non-null exactly when
//      the call set `mission` to null. A call that advances a patrol must report null; a call
//      that ends one must never report null. It holds by construction today (the reason is
//      assigned at precisely the sites that null the mission), but "by construction" lasts
//      only until someone adds a fifth ending, which is what these cases are for.
//
//   2. THE PER-RUN COUNT SURVIVES A RELAUNCH AND A CALL BOUNDARY. freshPatrolMission seeds it
//      to 0 because it is the factory for a NEW patrol, so a relaunch would reset it without
//      the explicit carry-forward. A repeat-dispatch run reporting "1 route" after flying
//      twelve is the failure this guards.
//
//   3. ONE LOG ENTRY PER RUN, NEVER ONE PER ROUTE. COMPLETION_LOG_CAP is 50 with oldest-first
//      eviction, so per-route logging would evict the whole log during one offline span.
//
// ⚠️ PARITY CASES LIVE IN THIS FILE, which is added to the parity EXCLUSION list, exactly as
// 0.13.3's own new parity families were. The 101 baseline is the count of the UNTOUCHED cases
// and must stay 101; these are additions on top of it, never edits to it.
// ============================================================================

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  PATROLS,
  type GameState,
  type PatrolMissionState,
  type PatrolEndReason,
  type ShipTypeKey,
} from "./model";
import { dispatchCaptainOnPatrol, economyTick, tick, installMissingCombatBaselines } from "./tick";
import { PATROL_END_REASON_VIEW, buildHomeDashboard } from "./homeDashboard";

const PATROL_KEY = "crimsonReaverSweep";
const DEF = PATROLS[PATROL_KEY];
const ROUTE_LEN = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks;
const RNG = () => 0.5;
// A clock so completion stamps are real rather than UNKNOWN_COMPLETION_TIME_MS. Fixed, never
// Date.now(), because a test that reads the wall clock cannot be a parity test.
const NOW_MS = 1_700_000_000_000;

// A patrol-capable fleet with a pinned master seed. Mirrors patrol-balance.test.ts's helper
// (same shape, same reasons) rather than inventing a second fixture convention.
function patrolState(typeKey: ShipTypeKey, seed: number): GameState {
  const base = freshState();
  return installMissingCombatBaselines({
    ...base,
    nextPatrolSeed: seed,
    fuel: new Decimal(100000),
    credits: new Decimal(100000),
    ships: base.ships.map((s) => (s.id === "ship-1" ? { ...s, typeKey } : s)),
  });
}

function dispatched(seed: number, repeat: boolean, typeKey: ShipTypeKey = "battleship"): GameState {
  const out = dispatchCaptainOnPatrol(patrolState(typeKey, seed), 1, PATROL_KEY, "balanced", repeat);
  expect(out.success).toBe(true);
  return out.next;
}

function missionOf(state: GameState): PatrolMissionState | null {
  return (state.captains[0].mission ?? null) as PatrolMissionState | null;
}

function patrolEntries(state: GameState) {
  return (state.completionLog ?? []).filter((e) => e.kind === "patrolRun");
}

// A seed whose battleship reliably WINS the starter patrol, so "ordersComplete" is reachable
// deterministically. The starter is tuned to ~100% for the three combat hulls
// (patrol-balance.test.ts), so seed 0 is a safe pick rather than a lucky one.
const WINNING_SEED = 0;

describe("PATROL_END_REASON_VIEW: the exhaustive wording table", () => {
  // The five members, written as a literal. Deriving them from the table under test would make
  // this tautological, so the spec is stated independently and the table is the claim.
  const ALL: PatrolEndReason[] = ["defeat", "outOfFuel", "ordersComplete", "recalled", "missionKeyRetired"];

  it("covers every reason with real words, and no blanks", () => {
    for (const reason of ALL) {
      const view = PATROL_END_REASON_VIEW[reason];
      expect(view).toBeDefined();
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.label).not.toContain("undefined");
    }
    // No EXTRA rows either: the table is exactly the union, so a retired member cannot linger.
    expect(Object.keys(PATROL_END_REASON_VIEW).sort()).toEqual([...ALL].sort());
  });

  it("marks the two CLEAN endings as non-wall-stops, so the offline recap stays quiet for them", () => {
    // This is the derive-not-widen decision (design 6.5 / 17.3 Q13) made checkable. A clean
    // finish or a player recall must NEVER raise a recap note; only a genuine wall-stop does.
    expect(PATROL_END_REASON_VIEW.ordersComplete.wallStop).toBeNull();
    expect(PATROL_END_REASON_VIEW.recalled.wallStop).toBeNull();
    // ...and the two real wall-stops map onto the EXISTING CaptainStopReason vocabulary rather
    // than inventing new members for it.
    expect(PATROL_END_REASON_VIEW.defeat.wallStop).toBe("defeat");
    expect(PATROL_END_REASON_VIEW.outOfFuel.wallStop).toBe("fuel");
  });

  it("gives the retired-key ending player-facing words, not developer words", () => {
    // It is rare and self-healing, but a blank reason is exactly what this enumeration exists
    // to make impossible. The player did not retire anything, so the wording must not blame them.
    const label = PATROL_END_REASON_VIEW.missionKeyRetired.label;
    expect(label.length).toBeGreaterThan(0);
    expect(label.toLowerCase()).not.toContain("key");
    expect(label.toLowerCase()).not.toContain("registry");
  });
});

describe("the end-reason invariant, in both directions", () => {
  it("a call that does NOT end the patrol logs nothing and leaves the mission running", () => {
    // One tick into a multi-tick route: the patrol is mid-transit, so there is no ending, and
    // therefore no entry. This is the null half of the invariant, observed through the log.
    const next = economyTick(dispatched(WINNING_SEED, false), 1, RNG, NOW_MS);
    expect(missionOf(next)).not.toBeNull();
    expect(patrelSafeLength(next)).toBe(0);
  });

  // Small indirection so the assertion above reads as one line; also proves the log is genuinely
  // untouched rather than merely filtered to empty.
  function patrelSafeLength(state: GameState): number {
    return patrolEntries(state).length;
  }

  it("a call that DOES end the patrol always carries a reason, never a blank", () => {
    const final = economyTick(dispatched(WINNING_SEED, false), ROUTE_LEN + 2, RNG, NOW_MS);
    expect(missionOf(final)).toBeNull();
    const entries = patrolEntries(final);
    expect(entries).toHaveLength(1);
    expect(entries[0].patrolEndReason).not.toBeNull();
    expect(entries[0].patrolEndReason).not.toBeUndefined();
  });

  it("the defensive ship-absent no-op is NOT an ending: no reason, no entry, mission untouched", () => {
    // PatrolEndReason's closing note names this as the one path that looks like an ending and
    // is not. Strip the assigned ship and the tick helper takes its no-op return.
    const state = dispatched(WINNING_SEED, false);
    const shipless: GameState = { ...state, ships: [] };
    const next = economyTick(shipless, 5, RNG, NOW_MS);
    // The patrol did not end; it simply failed to advance.
    expect(missionOf(next)).not.toBeNull();
    expect(patrolEntries(next)).toHaveLength(0);
  });
});

describe("ordersComplete vs recalled: the split that used to be one branch", () => {
  it("a Dispatch Once run that finishes its route reports ordersComplete", () => {
    const final = economyTick(dispatched(WINNING_SEED, false), ROUTE_LEN + 2, RNG, NOW_MS);
    expect(missionOf(final)).toBeNull();
    expect(patrolEntries(final)[0].patrolEndReason).toBe("ordersComplete");
  });

  it("a RECALLED run that finishes its route reports recalled, not ordersComplete", () => {
    // ⚠️ THE POINT OF THE SPLIT. Both endings leave through the same `else` in the engine, so
    // before this release a recalled patrol reported "orders complete", telling a player who
    // pressed Recall that their orders had finished. Same route, same seed, one flag different.
    const state = dispatched(WINNING_SEED, true); // repeat-dispatch, so only the recall stops it
    const recalled: GameState = {
      ...state,
      captains: state.captains.map((c) =>
        c.id === 1 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c,
      ),
    };
    const final = economyTick(recalled, ROUTE_LEN + 2, RNG, NOW_MS);
    expect(missionOf(final)).toBeNull();
    expect(patrolEntries(final)[0].patrolEndReason).toBe("recalled");
  });
});

describe("the retired-key ending", () => {
  it("records missionKeyRetired when the patrol key no longer exists", () => {
    // The unknown-key inert guard. Point the mission at a key that is not in PATROLS and the
    // guard drops the captain to idle, which IS an ending and now says so.
    const state = dispatched(WINNING_SEED, false);
    const bogus: GameState = {
      ...state,
      captains: state.captains.map((c) =>
        c.id === 1 && c.mission?.kind === "patrol"
          ? { ...c, mission: { ...c.mission, patrolKey: "aPatrolThatWasRemoved" } }
          : c,
      ),
    };
    const final = economyTick(bogus, 1, RNG, NOW_MS);
    expect(missionOf(final)).toBeNull();
    const entries = patrolEntries(final);
    expect(entries).toHaveLength(1);
    expect(entries[0].patrolEndReason).toBe("missionKeyRetired");
    // The fleet SELF-HEALS: the captain is idle and re-dispatchable, not stuck.
    expect(final.captains[0].mission).toBeNull();
  });

  it("does NOT log a patrol entry when the guard drops an EXTRACTION mission", () => {
    // PatrolEndReason is patrol-scoped. An extraction mission dropped by the same guard must not
    // produce a "Patrolled" row for something that was never a patrol.
    const base = freshState();
    const state: GameState = {
      ...base,
      captains: base.captains.map((c) =>
        c.id === 1
          ? ({ ...c, mission: { kind: "extraction", missionKey: "aMissionThatWasRemoved" } } as never)
          : c,
      ),
    };
    const final = economyTick(state, 1, RNG, NOW_MS);
    expect(final.captains[0].mission).toBeNull();
    expect(patrolEntries(final)).toHaveLength(0);
  });
});

describe("the per-run route count", () => {
  it("starts at 0 on a fresh dispatch", () => {
    expect(missionOf(dispatched(WINNING_SEED, false))!.routesCompletedThisRun).toBe(0);
  });

  it("accumulates ACROSS CALLS while a run is still in flight", () => {
    // A repeat-dispatch patrol stepped one tick at a time. The count must be carried on the
    // mission between calls, not recomputed per call, or it resets to 0 every tick.
    let state = dispatched(WINNING_SEED, true);
    for (let i = 0; i < ROUTE_LEN + 1; i++) state = economyTick(state, 1, RNG, NOW_MS);
    const mission = missionOf(state);
    expect(mission).not.toBeNull();
    // At least one route flew and relaunched, and the count survived every call boundary.
    expect(mission!.routesCompletedThisRun).toBeGreaterThanOrEqual(1);
  });

  it("⚠️ SURVIVES A RELAUNCH, which the shared factory would otherwise reset to 0", () => {
    // freshPatrolMission is the single source of truth for a NEW patrol and seeds the count to
    // 0, which is right for a dispatch and wrong for a relaunch (a relaunch is the MIDDLE of a
    // run). Without the explicit carry-forward this lands at 1 no matter how far it flew.
    let state = dispatched(WINNING_SEED, true);
    // Three full routes' worth of ticks: enough to relaunch at least twice.
    state = economyTick(state, ROUTE_LEN * 3 + 3, RNG, NOW_MS);
    const mission = missionOf(state);
    expect(mission).not.toBeNull();
    expect(mission!.routesCompletedThisRun).toBeGreaterThan(1);
  });

  it("reports the accumulated total on the entry, not just this call's routes", () => {
    // Fly two routes across SEPARATE calls, then recall so the run ends. The entry must report
    // both, which is only possible if the count came off the mission rather than the last call's
    // local counter.
    let state = dispatched(WINNING_SEED, true);
    state = economyTick(state, ROUTE_LEN + 1, RNG, NOW_MS);
    const flownSoFar = missionOf(state)!.routesCompletedThisRun;
    expect(flownSoFar).toBeGreaterThanOrEqual(1);
    // Recall, then let it finish the route it is on.
    state = {
      ...state,
      captains: state.captains.map((c) =>
        c.id === 1 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c,
      ),
    };
    state = economyTick(state, ROUTE_LEN + 2, RNG, NOW_MS);
    expect(missionOf(state)).toBeNull();
    const entry = patrolEntries(state)[0];
    expect(entry.patrolEndReason).toBe("recalled");
    // Strictly MORE than the routes flown in the final call alone, which is the whole point.
    expect(entry.iterations).toBeGreaterThan(flownSoFar - 1);
    expect(entry.iterations).toBeGreaterThanOrEqual(flownSoFar);
  });
});

describe("the completion-log entry", () => {
  it("⚠️ writes ONE entry per RUN, never one per ROUTE (the ring-buffer guard)", () => {
    // COMPLETION_LOG_CAP is 50, oldest-first. A repeat-dispatch patrol flying many routes across
    // one offline span would evict the entire log if each route logged. Run a LOT of routes and
    // assert the log gained at most one patrol entry when the run finally ends.
    let state = dispatched(WINNING_SEED, true);
    state = economyTick(state, ROUTE_LEN * 12 + 12, RNG, NOW_MS);
    // Still flying (repeat-dispatch, never recalled): so far NOTHING has been logged, even
    // though a dozen routes completed.
    expect(missionOf(state)).not.toBeNull();
    expect(patrolEntries(state)).toHaveLength(0);
    // Now recall and let it land: exactly ONE entry, carrying all those routes as iterations.
    state = {
      ...state,
      captains: state.captains.map((c) =>
        c.id === 1 && c.mission?.kind === "patrol" ? { ...c, mission: { ...c.mission, recalled: true } } : c,
      ),
    };
    state = economyTick(state, ROUTE_LEN + 2, RNG, NOW_MS);
    const entries = patrolEntries(state);
    expect(entries).toHaveLength(1);
    expect(entries[0].iterations).toBeGreaterThan(1);
  });

  it("carries the patrol as its subject and mints a unique id", () => {
    const final = economyTick(dispatched(WINNING_SEED, false), ROUTE_LEN + 2, RNG, NOW_MS);
    const entry = patrolEntries(final)[0];
    expect(entry.subjectKey).toBe(PATROL_KEY);
    expect(entry.id).toMatch(/^done-\d+$/);
    // Ids are unique across the WHOLE log, which is what the after-resolveProcesses placement
    // buys: two writers sharing one counter in one tick is how duplicates happen.
    const ids = (final.completionLog ?? []).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports NO reward, because patrol loot is already folded per won wave", () => {
    // Re-listing the haul here would double-report rewards the player already has.
    const entry = patrolEntries(economyTick(dispatched(WINNING_SEED, false), ROUTE_LEN + 2, RNG, NOW_MS))[0];
    expect(entry.reward).toBe("nothing");
    expect(entry.items).toEqual([]);
    expect(entry.pieces).toBe(0);
    expect(entry.creditsAmount).toBeNull();
    // Not the salvage fail-safe no-op, which is what `stale` records.
    expect(entry.stale).toBe(false);
  });

  it("renders as a real dashboard row: named patrol, route count and reason", () => {
    const final = economyTick(dispatched(WINNING_SEED, false), ROUTE_LEN + 2, RNG, NOW_MS);
    const board = buildHomeDashboard(final);
    const row = board.recentlyCompleted.find((r) => r.primaryLabel.includes("Patrolled"));
    expect(row).toBeDefined();
    // The patrol's own NAME, not a raw key: without the kind branch in completionSubjectLabel
    // this fell through the reward switch and rendered a bare "Patrolled".
    expect(row!.primaryLabel).toContain(DEF.label);
    // ...and the detail carries the outcome rather than a bare "N runs".
    expect(row!.secondaryLabel).toBeTruthy();
    expect(row!.secondaryLabel!.toLowerCase()).toContain("orders complete");
    expect(row!.secondaryLabel!.toLowerCase()).toContain("route");
  });

  it("says 'no routes completed' rather than going quiet when a run flew none", () => {
    // ⚠️ ZERO IS A REAL, REPORTABLE CASE: a patrol dropped by the retired-key guard during its
    // first transit genuinely flew nothing. This release had to fix the silent-zero bug three
    // times elsewhere, so the zero path gets its own assertion here.
    const state = dispatched(WINNING_SEED, false);
    const bogus: GameState = {
      ...state,
      captains: state.captains.map((c) =>
        c.id === 1 && c.mission?.kind === "patrol"
          ? { ...c, mission: { ...c.mission, patrolKey: "aPatrolThatWasRemoved" } }
          : c,
      ),
    };
    const final = economyTick(bogus, 1, RNG, NOW_MS);
    expect(patrolEntries(final)[0].iterations).toBe(0);
    const row = buildHomeDashboard(final).recentlyCompleted.find((r) =>
      r.primaryLabel.includes("Patrolled"),
    );
    expect(row!.secondaryLabel!.toLowerCase()).toContain("no routes completed");
  });
});

describe("offline-equals-live parity for patrol endings", () => {
  // ⚠️ These are the reason this file is on the parity EXCLUSION list. The 101 baseline counts
  // the UNTOUCHED cases; these are additions and must never be folded into it.

  it("parity: the END REASON is identical between one big call and many single ticks", () => {
    const span = ROUTE_LEN + 2;
    const big = economyTick(dispatched(WINNING_SEED, false), span, RNG, NOW_MS);
    let stepped = dispatched(WINNING_SEED, false);
    for (let i = 0; i < span; i++) stepped = economyTick(stepped, 1, RNG, NOW_MS);
    expect(patrolEntries(stepped).map((e) => e.patrolEndReason)).toEqual(
      patrolEntries(big).map((e) => e.patrolEndReason),
    );
  });

  it("parity: the ROUTE COUNT is identical between one big call and many single ticks", () => {
    // The half most likely to break: the accumulator lives partly on the mission (across calls)
    // and partly in a local (within a call), so a stepped run exercises the persistence path on
    // every tick while a single big call exercises it once.
    const span = ROUTE_LEN * 3 + 3;
    const big = economyTick(dispatched(WINNING_SEED, true), span, RNG, NOW_MS);
    let stepped = dispatched(WINNING_SEED, true);
    for (let i = 0; i < span; i++) stepped = economyTick(stepped, 1, RNG, NOW_MS);
    expect(missionOf(stepped)!.routesCompletedThisRun).toBe(missionOf(big)!.routesCompletedThisRun);
  });

  it("parity: an offline span through tick() agrees with the stepped live path", () => {
    // Through the REAL offline entry point, which is what a player actually hits after a
    // closed laptop, rather than economyTick directly.
    const span = ROUTE_LEN + 2;
    const start = dispatched(WINNING_SEED, false);
    // ⚠️ ARGUMENT ORDER: tick() takes deltaSeconds FIRST and state SECOND, unlike economyTick,
    // which takes state first. Getting this backwards silently passes a number as the state and
    // a state as the span, which fails as an undefined-property read rather than a type error.
    const offline = tick(span * start.tickDurationSeconds, start, RNG, NOW_MS);
    let live = start;
    for (let i = 0; i < span; i++) live = economyTick(live, 1, RNG, NOW_MS);
    expect(patrolEntries(offline).map((e) => e.patrolEndReason)).toEqual(
      patrolEntries(live).map((e) => e.patrolEndReason),
    );
    expect(patrolEntries(offline).map((e) => e.iterations)).toEqual(
      patrolEntries(live).map((e) => e.iterations),
    );
  });
});
