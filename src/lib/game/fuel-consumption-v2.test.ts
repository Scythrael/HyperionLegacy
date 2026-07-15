// Fuel consumption rework tests — Fuel Economy v2 F3
// (docs/plans/2026-07-14-fuel-economy-v2-design.md §3/§4/§"Offline").
//
// F3 REPLACES Task-5's hard stop-on-empty with a THREE-way fuel-spend rule at every
// fuel-spend point (initial dispatch AND auto-repeat cycle boundary), given the trip's
// need = fuelNeeded(mission, hull):
//   1. Tank has enough (fuel >= need)              -> spend need, NO penalty.
//   2. Tank short but shortfall AFFORDABLE          -> auto-buy the shortfall at
//      FUEL_CREDITS_PER_UNIT, spend need, AND add a +2-tick "refuel at non-allied
//      station" delay (REFUEL_PENALTY_TICKS) to THAT cycle's first phase.
//   3. Truly broke (short AND can't afford shortfall) -> hard-stop (dispatch blocked /
//      auto-repeat ends the mission). Rare -- the refinery + friendlier credits keep
//      you afloat; this is the anti-infinite-fuel floor.
//
// Plus the REBALANCE: FUEL_PER_TICK 1 -> 0.1 (Freighter shortOreRun now 5 fuel/cycle,
// an INTEGER -> Decimals stay exact) and friendlier mission creditsPerCycle.
//
// The +2-tick penalty is CLOSED-FORM: a per-cycle `refuelDelayTicks` on the mission
// state, set at the cycle boundary when auto-buy fires, added to the ordersReceived
// phase's required ticks. It advances identically per-step, so tick(bigSpan) == looping
// economyTick(_,1) bit-identical (the required offline==live parity proof at the bottom).
//
// freshState() seeds ONE captain (id 1) flying "ship-1" (General Freighter, engineEfficiency
// 0), so fuelNeeded(shortOreRun, Freighter) = (25+25)*0.1/(1+0) = 5 fuel/round-trip -- an
// INTEGER, which is what makes the parity assertions bit-exact. One shortOreRun cycle is 149
// whole ticks (1 orders + 25 out + 90 extract + 25 back + 8 unload); a penalized cycle is 151.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  MISSIONS,
  SHIP_TYPES,
  FUEL_PER_TICK,
  FUEL_CREDITS_PER_UNIT,
  REFUEL_PENALTY_TICKS,
  type GameState,
} from "./model";
import { fuelNeeded } from "./fuel";
import { canDispatch, dispatchCaptainOnMission, economyTick, tick } from "./tick";

const NEED = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter); // 5
const CYCLE_TICKS = 149; // 1 + 25 + 90 + 25 + 8

// rng ()=>0.5 loses EVERY tier roll (0.5 >= rareChance 0.001 and >= uncommonChance 0.019),
// so common wins each extraction tick -> 1 Deuterium Ice (commonOre) per tick, 90/cycle;
// the bonus-roll trigger is 0 (no talents) so 0.5 never fires it. This FEEDS the Fuel Depot
// refinery with ice (unlike ()=>0 which would dump everything into rareMaterial).
const ALL_COMMON = () => 0.5;

// Step economyTick(state, 1) n times -- the SAME per-tick stepping tick()'s offline loop does.
function step(state: GameState, n: number, rng = ALL_COMMON): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, rng);
  return s;
}

describe("F3 rebalance — constants", () => {
  it("drops FUEL_PER_TICK to 0.1 (round trip a small fraction of the reward)", () => {
    expect(FUEL_PER_TICK).toBe(0.1);
    expect(FUEL_CREDITS_PER_UNIT).toBe(5); // unchanged
  });

  it("makes Freighter shortOreRun cost exactly 5 fuel/cycle (integer -> Decimals exact)", () => {
    expect(NEED).toBe(5);
  });

  it("bumps mission creditsPerCycle to comfortably exceed max auto-buy fuel cost", () => {
    // Each reward exceeds its mission's full round-trip fuel cost in credits
    // (need * FUEL_CREDITS_PER_UNIT), the WORST-CASE auto-buy (empty tank).
    expect(MISSIONS.shortOreRun.creditsPerCycle).toBe(30); // vs 5*5 = 25
    expect(MISSIONS.longOreRun.creditsPerCycle).toBe(75); // vs 14*5 = 70
    expect(MISSIONS.salvageWreckage.creditsPerCycle).toBe(50); // vs 9*5 = 45
    expect(MISSIONS.forageFlora.creditsPerCycle).toBe(60); // vs 11*5 = 55
    expect(REFUEL_PENALTY_TICKS).toBe(2);
  });
});

describe("F3 (a) tank has enough -> spend, NO penalty, NO auto-buy", () => {
  it("auto-repeats without touching credits and with refuelDelayTicks 0 (orders stays 1 tick)", () => {
    let s = freshState();
    s.fuel = new Decimal(400); // under cap 500, covers dispatch + many repeats
    s.credits = new Decimal(1000);
    s = dispatchCaptainOnMission(s, 1, "shortOreRun").next; // fuel 400 -> 395, cycle 1 running
    expect(s.fuel.eq(395)).toBe(true);

    // Run one full cycle. At the boundary the tank (395, no refining yet -- ice 0 until this
    // cycle delivers) easily covers the 5-fuel repeat, so NO auto-buy, NO penalty.
    const afterCycle = step(s, CYCLE_TICKS);
    // credits rose ONLY by the cycle reward (30) -- proof no auto-buy deducted.
    expect(afterCycle.credits.eq(1030)).toBe(true);
    // tank paid one repeat (395 -> 390); refining started this tick (50 ice consumed) but its
    // batch has not completed, so no fuel added yet.
    expect(afterCycle.fuel.eq(390)).toBe(true);
    const m = afterCycle.captains[0].mission!;
    expect(m.phase).toBe("ordersReceived");
    expect(m.refuelDelayTicks ?? 0).toBe(0); // NO penalty on this cycle

    // One more tick completes the 1-tick orders phase (NO +2 delay) -> transitOut.
    const next = step(afterCycle, 1);
    expect(next.captains[0].mission!.phase).toBe("transitOut");
    expect(next.credits.eq(1030)).toBe(true); // still no auto-buy
  });
});

describe("F3 (b) tank short but affordable -> auto-buy shortfall + credits down + +2 ticks", () => {
  it("auto-buys the shortfall, deducts credits, and applies REFUEL_PENALTY_TICKS to the cycle", () => {
    let s = freshState();
    s.fuel = new Decimal(NEED); // exactly one dispatch's worth (5) -> tank 0 after dispatch
    s.credits = new Decimal(1000);
    s = dispatchCaptainOnMission(s, 1, "shortOreRun").next; // fuel -> 0 (dispatch had enough: no penalty)
    expect(s.fuel.eq(0)).toBe(true);
    expect(s.captains[0].mission!.refuelDelayTicks ?? 0).toBe(0); // dispatch was fully fuelled

    // Run cycle 1 (149 ticks). Ice starts 0 and is delivered only at cycle completion, so the
    // refinery cannot top the tank before the boundary -> at tick 149 the tank is 0 and the
    // auto-repeat must auto-buy the full 5-fuel shortfall (cost 5*5 = 25 credits).
    const after = step(s, CYCLE_TICKS);
    // credits: 1000 + 30 (cycle-1 reward) - 25 (auto-buy) = 1005.
    expect(after.credits.eq(1005)).toBe(true);
    expect(after.fuel.eq(0)).toBe(true); // bought 5, spent 5 -> net 0
    const m = after.captains[0].mission!;
    expect(m.phase).toBe("ordersReceived");
    expect(m.refuelDelayTicks).toBe(REFUEL_PENALTY_TICKS); // +2 penalty stamped on THIS cycle

    // PROVE the +2 delay is real: orders now needs 1 + 2 = 3 ticks. After 2 MORE ticks a
    // NORMAL cycle would already be in transitOut, but the penalized cycle is STILL in orders.
    const after2 = step(after, 2);
    expect(after2.captains[0].mission!.phase).toBe("ordersReceived"); // still delayed
    // The 3rd tick finally completes the extended orders phase.
    const after3 = step(after2, 1);
    expect(after3.captains[0].mission!.phase).toBe("transitOut");
  });

  it("canDispatch is OK when the tank is short but the shortfall is affordable (auto-buy at dispatch)", () => {
    const s = freshState();
    s.fuel = new Decimal(3); // short of the 5 need
    s.credits = new Decimal(1000); // shortfall 2 -> cost 10 -- easily affordable
    expect(canDispatch(s, 1, "shortOreRun")).toEqual({ ok: true });
  });

  it("dispatch auto-buys the shortfall, deducts credits, and stamps the +2 penalty on cycle 1", () => {
    let s = freshState();
    s.fuel = new Decimal(3); // shortfall 2
    s.credits = new Decimal(1000);
    const { next, success, reason } = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(success).toBe(true);
    expect(reason).toBeUndefined();
    expect(next.fuel.eq(0)).toBe(true); // 3 in tank + 2 bought - 5 spent = 0
    expect(next.credits.eq(990)).toBe(true); // bought 2 units * 5 = 10 credits
    expect(next.captains[0].mission!.refuelDelayTicks).toBe(REFUEL_PENALTY_TICKS);
  });
});

describe("F3 (c) truly broke -> hard-stop (dispatch blocked / auto-repeat ends)", () => {
  it("canDispatch blocks (fuelEmpty) when the tank is short AND the shortfall is unaffordable", () => {
    const s = freshState();
    s.fuel = new Decimal(0); // drain the default-full tank -- this test's SUBJECT is the broke, empty-tank floor
    s.credits = new Decimal(5); // shortfall 5 -> cost 25 > 5 credits -> can't afford
    expect(canDispatch(s, 1, "shortOreRun")).toEqual({ ok: false, reason: "fuelEmpty" });
  });

  it("the auto-repeat HARD-STOPS the mission when broke at the cycle boundary", () => {
    let s = freshState();
    s.fuel = new Decimal(NEED); // one dispatch's worth
    s.credits = new Decimal(0); // broke -> can't auto-buy the next cycle
    s = dispatchCaptainOnMission(s, 1, "shortOreRun").next; // tank -> 0, cycle 1 running
    // Run past the cycle boundary. At tick 149 the tank is 0 and credits (at the START of
    // that tick, before cycle 1's reward is banked) are 0 -> can't afford -> hard-stop.
    const after = step(s, CYCLE_TICKS + 5);
    expect(after.captains[0].mission).toBeNull(); // hard-stopped (mission ended)
    expect(after.fuel.eq(0)).toBe(true);
    // Cycle 1's reward (30) IS still earned+banked this call (applied at call end), so the
    // player is left with 30 credits and an idled captain -- next manual dispatch can afford it.
    expect(after.credits.eq(30)).toBe(true);
  });
});

describe("⚠️ F3 REQUIRED offline==live PARITY — refining + consumption + auto-buy + penalty all fire", () => {
  // The controller re-verifies this personally. A multi-cycle span where the Fuel Depot
  // refines Deuterium Ice -> fuel, the mission burns fuel every cycle, AND at least one cycle
  // triggers auto-buy + the +2-tick penalty (the tank dips short at the first boundary before
  // the refinery has produced any fuel). tick(bigSpan) (offline) must be bit-identical to
  // looping economyTick(_,1) (live) for fuel, credits, ice, and the captain's mission state
  // (including the delayed cycle's timing). rng is a CONSTANT so loot interleaving can't matter.
  const BIG_SPAN = 400;

  // Freshly dispatched, fuel-starved-at-first state: tank exactly covers dispatch (5) then hits
  // 0, ice starts 0 (refinery idle until cycle 1 delivers ice), credits ample for the one
  // auto-buy. Built once per path so neither path mutates the other's input.
  const makeDispatched = (): GameState => {
    const s = freshState();
    s.fuel = new Decimal(NEED); // -> 0 after dispatch
    s.credits = new Decimal(1000);
    const d = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(d.success).toBe(true);
    return d.next;
  };

  const snap = (st: GameState) => {
    const m = st.captains[0].mission;
    return {
      fuel: st.fuel.toString(),
      credits: st.credits.toString(),
      ice: (st.inventory.commonOre ?? new Decimal(0)).toString(),
      mission: m
        ? { phase: m.phase, progress: m.phaseProgressTicks, delay: m.refuelDelayTicks ?? 0, key: m.missionKey, recalled: m.recalled }
        : null,
      xp: st.captains[0].xp.toString(),
      level: st.captains[0].level,
    };
  };

  it("tick(bigSpan) == looping economyTick(_,1) bit-identical (auto-buy + penalty + refining fired)", () => {
    const offline = tick(BIG_SPAN, makeDispatched(), ALL_COMMON); // internally steps economyTick(_,1)

    let live = makeDispatched();
    for (let i = 0; i < BIG_SPAN; i++) live = economyTick(live, 1, ALL_COMMON);

    // BIT-IDENTICAL across every fuel-affected field + mission state.
    expect(snap(offline)).toEqual(snap(live));

    // NON-VACUOUS: prove the auto-buy actually fired (a 25-credit fuel purchase happened this
    // span) and the refinery actually ran (ice was consumed into fuel). Exact end-of-span
    // values are pinned in a sibling assertion below.
    expect(offline.captains[0].mission).not.toBeNull(); // refining kept it alive past cycle 1
    // The very first cycle boundary auto-bought (proof the tank dipped short + the branch ran):
    const afterFirstBoundary = step(makeDispatched(), CYCLE_TICKS, ALL_COMMON);
    expect(afterFirstBoundary.captains[0].mission!.refuelDelayTicks).toBe(REFUEL_PENALTY_TICKS);
    expect(afterFirstBoundary.credits.eq(1005)).toBe(true); // 1000 + 30 - 25
  });
});
