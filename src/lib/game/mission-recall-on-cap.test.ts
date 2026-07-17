// Mission recall-on-cap tests -- bugfix "fix/mission-recall-on-cap".
//
// THE BUG (pre-fix): the auto-stop at economyTick's per-captain gate (tick.ts, the
// `if (materialAtCap(...)) return captain;` branch) FROZE a captain in place when its
// mission's primary material hit its warehouse cap. `return captain` (unchanged) means
// no phase advance and no recall -- a ship already OUT was stranded mid-mission and, if
// the cap persisted (e.g. a full fuel tank so mined Deuterium Ice never drains), FROZEN
// FOREVER. It only "un-froze" if the material later dropped below cap.
//
// DESIRED behavior (user-confirmed: "return to base, then idle for re-dispatch"). A
// captain whose primary material is at cap must end up IDLE AT BASE (mission === null),
// never frozen mid-mission, and must NOT auto-repeat while capped. Two cases by phase:
//   - MID-CYCLE (ship OUT: transitOut | extracting | transitBack | unloading): flag the
//     mission `recalled` and let the NORMAL advance carry it home + unload + end (mission
//     -> null on the cycle's unloading completion). This REUSES the existing recall
//     mechanic exactly (recallCaptain sets `recalled`; the cycle-completion branch nulls
//     the mission when `recalled`). No freeze -- it progresses toward home every tick.
//   - AT BASE (phase `ordersReceived`, the pre-departure paperwork phase -- the ONLY
//     phase where the ship hasn't left home): do NOT dispatch a capped run at all. End
//     the mission immediately (mission -> null), captain idle at base.
//
// OFFLINE PARITY: the gate lives INSIDE economyTick, and BOTH the live loop and tick()'s
// offline catch-up step economyTick(state, 1) per whole tick (tick.ts:1623-1625). So the
// cap is re-evaluated every tick on both paths and recall-on-cap resolves identically --
// proven bit-exactly by the parity test at the bottom (the controller re-verifies it).
//
// Test scaffolding mirrors fuel-consumption-v2.test.ts: freshState() seeds ONE captain
// (id 1) flying a General Freighter; shortOreRun's primaryMaterial is `commonOre`
// (Titanium Ore, tier 1, warehouse cap 1,000,000 at facility level 0). Forcing at-cap =
// setting inventory.commonOre to 1,000,000 (materialAtCap uses `>=`). rng is a CONSTANT
// (ALL_COMMON) so loot interleaving can't perturb any comparison.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, MISSIONS, WAREHOUSE_T1_BASE_CAP, type GameState } from "./model";
import { dispatchCaptainOnMission, economyTick, tick, materialAtCap } from "./tick";

// shortOreRun cycle geometry (see fuel-consumption-v2.test.ts header): 1 orders + 25
// transitOut + 90 extract + 25 transitBack + 8 unload = 149 whole ticks.
const CYCLE_TICKS = 149;
// Ticks to sit safely inside the extracting phase (ship is OUT): 1 orders + 25 transitOut
// = 26 to reach extracting-progress-0; +4 lands mid-extraction.
const TICKS_INTO_EXTRACTING = 30;
// shortOreRun's primary material and its level-0 warehouse cap.
const PRIMARY = MISSIONS.shortOreRun.primaryMaterial; // "commonOre"
const CAP = WAREHOUSE_T1_BASE_CAP; // 1,000,000

// rng ()=>0.5 loses every tier roll, so every extraction tick deposits the common
// fallback -- deterministic, keeping loot out of the comparisons.
const ALL_COMMON = () => 0.5;

// Step economyTick(state, 1) n times -- the SAME per-tick stepping tick()'s offline loop
// does, so a `step(s, n)` result equals `tick(n, s)` for an integer n at the 1s cadence.
function step(state: GameState, n: number, rng = ALL_COMMON): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, rng);
  return s;
}

// Immutably force the fleet's stock of `itemId` to `amount` (a fresh Decimal).
function withStock(s: GameState, itemId: string, amount: number): GameState {
  return { ...s, inventory: { ...s.inventory, [itemId]: new Decimal(amount) } };
}

describe("mission recall-on-cap -- MID-CYCLE (ship OUT) recalls home + idles, never freezes", () => {
  it("flags `recalled` (not freeze) when primary hits cap mid-extraction, then returns home and idles", () => {
    // Dispatch, then advance the ship OUT to the extracting phase (below cap the whole way).
    let s = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    s = step(s, TICKS_INTO_EXTRACTING);
    const mid = s.captains[0].mission!;
    expect(mid.phase).toBe("extracting"); // sanity: the ship is genuinely OUT
    expect(mid.recalled).toBe(false); // ...and not yet recalled

    // Fill the warehouse: the primary material now sits AT its cap.
    s = withStock(s, PRIMARY, CAP);
    expect(materialAtCap(s, PRIMARY)).toBe(true);
    const beforePhase = s.captains[0].mission!.phase;
    const beforeProgress = s.captains[0].mission!.phaseProgressTicks;

    // ONE tick: the at-cap gate must FLAG recalled and ADVANCE (not return the captain
    // unchanged as the old freeze did).
    const t1 = economyTick(s, 1, ALL_COMMON);
    const m1 = t1.captains[0].mission!;
    expect(m1.recalled).toBe(true); // recall flagged -- the reused recall mechanic
    // NOT frozen: state moved (phase changed OR progress advanced), never sat unchanged.
    const advanced = m1.phase !== beforePhase || m1.phaseProgressTicks !== beforeProgress;
    expect(advanced).toBe(true);

    // Stepped forward a full cycle's worth, it finishes the trip home + unload and ENDS
    // (mission -> null == idle at base), rather than freezing forever.
    const done = step(t1, CYCLE_TICKS);
    expect(done.captains[0].mission).toBeNull();
  });
});

describe("mission recall-on-cap -- AT BASE (ordersReceived) idles immediately, does NOT dispatch", () => {
  it("ends the mission on the first capped tick without running an out-and-back loop", () => {
    // Freshly dispatched: phase is ordersReceived (pre-departure, still at base).
    let s = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    expect(s.captains[0].mission!.phase).toBe("ordersReceived");

    // Primary material at cap BEFORE it leaves base.
    s = withStock(s, PRIMARY, CAP);
    const primaryBefore = s.inventory[PRIMARY];
    const creditsBefore = s.credits;

    // ONE tick idles it immediately (mission -> null) -- it never launched the capped run.
    const t1 = economyTick(s, 1, ALL_COMMON);
    expect(t1.captains[0].mission).toBeNull();
    // Proof it did NOT run a cycle: no fresh haul deposited (primary unchanged) and no
    // cycle reward banked (credits unchanged). A dispatched-and-run loop would move both.
    expect(t1.inventory[PRIMARY].eq(primaryBefore)).toBe(true);
    expect(t1.credits.eq(creditsBefore)).toBe(true);
  });
});

describe("mission recall-on-cap -- BELOW cap is unchanged (anti-regression guard)", () => {
  it("a below-cap captain is never recalled and runs its mission normally (deposits + auto-repeat)", () => {
    let s = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    expect(materialAtCap(s, PRIMARY)).toBe(false); // fresh warehouse is empty -- well below cap

    // Run a full cycle. The at-cap branch must NOT fire: recalled stays false, the mission
    // auto-repeats (back to ordersReceived, mission non-null), and its haul was deposited.
    const after = step(s, CYCLE_TICKS);
    const m = after.captains[0].mission!;
    expect(m).not.toBeNull();
    expect(m.recalled).toBe(false); // below cap never touches the recall path
    // shortOreRun with ALL_COMMON deposits its common fallback each of the 90 extract ticks
    // -> a positive commonOre haul landed at unloading (proves the normal loop ran).
    expect((after.inventory[PRIMARY] ?? new Decimal(0)).gt(0)).toBe(true);
    // Auto-repeat re-entered ordersReceived (the pre-departure phase of the NEXT cycle).
    expect(m.phase).toBe("ordersReceived");
  });
});

describe("mission recall-on-cap -- does NOT auto-resume while still capped", () => {
  it("once idled at base by the cap, the captain stays idle (mission stays null)", () => {
    // Drive a mid-cycle recall to completion (as in the first suite), material still at cap.
    let s = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    s = step(s, TICKS_INTO_EXTRACTING);
    s = withStock(s, PRIMARY, CAP);
    const done = step(s, CYCLE_TICKS + 1); // finishes the recalled cycle -> idle
    expect(done.captains[0].mission).toBeNull();
    expect(materialAtCap(done, PRIMARY)).toBe(true); // still capped

    // Many more ticks: it must NOT re-dispatch itself -- idle is terminal until the player acts.
    const later = step(done, 300);
    expect(later.captains[0].mission).toBeNull();
  });
});

describe("⚠️ mission recall-on-cap -- REQUIRED offline==live PARITY (recall fires mid-span, ends idle)", () => {
  // The controller re-verifies this personally. A span that starts with the ship OUT
  // (extracting) and the primary material AT cap: the recall fires mid-span, the ship flies
  // home + unloads, and the mission ends (mission -> null). tick(bigSpan) (offline) must be
  // bit-identical to looping economyTick(_,1) (live) for the captain/ships/inventory. rng is
  // a CONSTANT so loot interleaving can't perturb the comparison.
  const SPAN = 200; // > the ~119 ticks left to finish the cycle from mid-extraction, with margin

  // Built fresh per path so neither path mutates the other's input. Ship is OUT (extracting)
  // and the primary material is pinned AT cap.
  const makeMidMissionAtCap = (): GameState => {
    let s = dispatchCaptainOnMission(freshState(), 1, "shortOreRun").next;
    s = step(s, TICKS_INTO_EXTRACTING);
    return withStock(s, PRIMARY, CAP);
  };

  const snap = (st: GameState) => {
    const m = st.captains[0].mission;
    return {
      inventory: Object.fromEntries(Object.entries(st.inventory).map(([k, v]) => [k, v.toString()])),
      fuel: st.fuel.toString(),
      credits: st.credits.toString(),
      ships: st.ships.map((sh) => ({ id: sh.id, assignedCaptainId: sh.assignedCaptainId, typeKey: sh.typeKey })),
      mission: m
        ? { phase: m.phase, progress: m.phaseProgressTicks, key: m.missionKey, recalled: m.recalled, delay: m.refuelDelayTicks ?? 0 }
        : null,
      xp: st.captains[0].xp.toString(),
      level: st.captains[0].level,
    };
  };

  it("tick(bigSpan) == looping economyTick(_,1) bit-identical across a cap-triggered recall", () => {
    const base = makeMidMissionAtCap();
    // Sanity: the pre-span state is genuinely OUT-and-capped (so the null-at-end below is
    // caused by the recall firing IN-span, not a pre-existing idle).
    expect(base.captains[0].mission!.phase).toBe("extracting");
    expect(base.captains[0].mission!.recalled).toBe(false);
    expect(materialAtCap(base, PRIMARY)).toBe(true);

    const offline = tick(SPAN, base, ALL_COMMON); // internally steps economyTick(_,1)

    // Live path: one tick at a time, watching the recall flag actually flip mid-span.
    let live = base;
    let sawRecalled = false;
    for (let i = 0; i < SPAN; i++) {
      live = economyTick(live, 1, ALL_COMMON);
      if (live.captains[0].mission?.recalled) sawRecalled = true;
    }

    // BIT-IDENTICAL across inventory, fuel, credits, ships, and mission/captain state.
    expect(snap(offline)).toEqual(snap(live));

    // NON-VACUOUS: the recall actually fired mid-span AND the captain ended idle at base.
    expect(sawRecalled).toBe(true);
    expect(offline.captains[0].mission).toBeNull();
    expect(live.captains[0].mission).toBeNull();
  });
});
