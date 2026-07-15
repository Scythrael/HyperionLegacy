// Fuel consumption rework tests — Fuel Economy v2 F3
// (docs/plans/2026-07-14-fuel-economy-v2-design.md §3/§4/§"Offline"),
// UPDATED for the 2026-07-15 fuel-sourcing RESTRUCTURE (see below).
//
// F3 REPLACES Task-5's hard stop-on-empty with a THREE-way fuel-spend rule at every
// fuel-spend point (initial dispatch AND auto-repeat cycle boundary), given the trip's
// need = fuelNeeded(mission, hull):
//   1. Tank has enough (fuel >= need)              -> spend need, NO penalty.
//   2. Tank short but shortfall AFFORDABLE          -> auto-buy the shortfall at
//      FUEL_CREDITS_PER_UNIT, spend need, AND add a +2-tick "refuel at non-allied
//      station" delay (REFUEL_PENALTY_TICKS) to THAT cycle's first phase.
//   3. Truly broke (short AND can't afford shortfall) -> hard-stop (dispatch blocked /
//      auto-repeat ends the mission). The anti-infinite-fuel floor.
//
// ⚠️ FUEL-SOURCING RESTRUCTURE (2026-07-15) ⚠️ Two things change here:
//   (a) FUEL_CREDITS_PER_UNIT 5 -> 20 -- credit auto-buy is now EXPENSIVE (a Freighter
//       shortOreRun empty-tank top-up is 50*20 = 1000cr), so the hardcoded auto-buy cost
//       assertions below moved from *5 to *20.
//   (b) The Fuel Depot now refines the DEDICATED `deuteriumIce` item, NOT `commonOre`.
//       shortOreRun's common drop is `commonOre` (Titanium Ore) again, which the depot no
//       longer touches -- so a shortOreRun mission NO LONGER self-feeds its own refinery.
//       The refining scenarios below therefore SEED a `deuteriumIce` reserve (as the free
//       localFuelRun mission supplies in real play) so refining still fires. This is the
//       "update the refinery-input seed commonOre -> deuteriumIce" the restructure calls for.
//
// The +2-tick penalty is CLOSED-FORM: a per-cycle `refuelDelayTicks` on the mission
// state, set at the cycle boundary when auto-buy fires, added to the ordersReceived
// phase's required ticks. It advances identically per-step, so tick(bigSpan) == looping
// economyTick(_,1) bit-identical (the required offline==live parity proof at the bottom).
//
// freshState() seeds ONE captain (id 1) flying "ship-1" (General Freighter, engineEfficiency
// 0), so fuelNeeded(shortOreRun, Freighter) = (25+25)*1/(1+0) = 50 fuel/round-trip -- an
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
  FUEL_REFINE_OUTPUT,
  FUEL_REFINE_DURATION_TICKS,
  type GameState,
} from "./model";
import { fuelNeeded } from "./fuel";
import { canDispatch, dispatchCaptainOnMission, economyTick, tick } from "./tick";

const NEED = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter); // 50
const CYCLE_TICKS = 149; // 1 + 25 + 90 + 25 + 8
const AUTOBUY_COST = NEED * FUEL_CREDITS_PER_UNIT; // 50 * 20 = 1000 (empty-tank top-up)

// rng ()=>0.5 loses EVERY tier roll (0.5 >= rareChance 0.001 and >= uncommonChance 0.019),
// so common wins each extraction tick. For shortOreRun that deposits commonOre (Titanium Ore),
// NOT Deuterium Ice -- the restructure decoupled the two. Refining is fed by a SEEDED
// deuteriumIce reserve in the tests that exercise it (see the header note). Using a constant
// rng keeps loot interleaving out of the parity comparison.
const ALL_COMMON = () => 0.5;

// Seeds a Deuterium Ice reserve onto a state (immutably), standing in for the free
// localFuelRun mission's ice output so the Fuel Depot's pipelines have something to refine.
function withIce(s: GameState, amount: number): GameState {
  return { ...s, inventory: { ...s.inventory, deuteriumIce: new Decimal(amount) } };
}

// Step economyTick(state, 1) n times -- the SAME per-tick stepping tick()'s offline loop does.
function step(state: GameState, n: number, rng = ALL_COMMON): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, rng);
  return s;
}

describe("F3 retune — constants", () => {
  it("keeps FUEL_PER_TICK at 1 and makes credit auto-buy EXPENSIVE (FUEL_CREDITS_PER_UNIT 5 -> 20)", () => {
    expect(FUEL_PER_TICK).toBe(1);
    expect(FUEL_CREDITS_PER_UNIT).toBe(20); // restructure: expensive convenience, not a crutch
  });

  it("makes Freighter shortOreRun cost exactly 50 fuel/cycle (integer -> Decimals exact)", () => {
    expect(NEED).toBe(50);
  });

  it("KEEPS the friendlier mission creditsPerCycle as generous rewards (NOT the non-bricking mechanism)", () => {
    // These values are UNCHANGED -- they stay as generous rewards. At FUEL_CREDITS_PER_UNIT 20
    // a reward is now FAR below its mission's worst-case (empty-tank) auto-buy cost, and it does
    // not need to match it: non-bricking comes from refining Deuterium Ice (mined free on
    // localFuelRun) + the full starting tank, not from credit-funded auto-buy.
    expect(MISSIONS.shortOreRun.creditsPerCycle).toBe(30); // worst-case auto-buy is now 50*20 = 1000
    expect(MISSIONS.longOreRun.creditsPerCycle).toBe(75); // worst-case auto-buy is now 140*20 = 2800
    expect(MISSIONS.salvageWreckage.creditsPerCycle).toBe(50); // worst-case auto-buy is now 90*20 = 1800
    expect(MISSIONS.forageFlora.creditsPerCycle).toBe(60); // worst-case auto-buy is now 110*20 = 2200
    expect(REFUEL_PENALTY_TICKS).toBe(2);
  });
});

describe("F3 — SUSTAINABILITY is the non-bricking guarantee (refining, not credit auto-buy)", () => {
  it("the Fuel Depot's production RATE far exceeds a mission's consumption RATE", () => {
    // Level-0 depot: one batch = FUEL_REFINE_OUTPUT (100) fuel over FUEL_REFINE_DURATION_TICKS
    // (10) ticks = 10 fuel/tick produced, vs shortOreRun's NEED (50) spread over CYCLE_TICKS
    // (149) = ~0.336 fuel/tick consumed. Production dwarfs consumption (>25x), so a tank fed
    // ice trends toward its cap instead of draining -- refining keeps the fuel economy afloat.
    const productionPerTick = FUEL_REFINE_OUTPUT / FUEL_REFINE_DURATION_TICKS; // 100 / 10 = 10
    const consumptionPerTick = NEED / CYCLE_TICKS; // 50 / 149 ~= 0.336
    expect(productionPerTick).toBeGreaterThan(consumptionPerTick);
    expect(productionPerTick).toBeGreaterThan(consumptionPerTick * 25); // not marginal -- a huge margin
  });

  it("a fresh game with a Deuterium Ice reserve stays fuel-healthy for many cycles on refining alone", () => {
    // BEHAVIORAL proof. freshState = full 500 tank, 0 credits. SEED a Deuterium Ice reserve
    // (as the free localFuelRun supplies in play), then dispatch shortOreRun (the full tank
    // funds the first trip with NO credits) and run 5 full cycles fed only by refining that ice.
    let s = withIce(freshState(), 5000);
    const dispatched = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(dispatched.success).toBe(true); // full starting tank dispatches with no credits
    s = dispatched.next; // fuel 500 -> 450
    const SPAN = CYCLE_TICKS * 5 + 20; // ~5 full auto-repeat cycles, plus margin into the 6th
    const after = step(s, SPAN);

    // (1) NEVER fuel-starved out: the mission is still auto-repeating after 5 cycles.
    expect(after.captains[0].mission).not.toBeNull();
    // (2) Still self-funding from the tank alone: fuel >= one round trip's NEED.
    expect(after.fuel.gte(NEED)).toBe(true);
    // (3) NON-VACUOUS refining proof: the tank ended >= its post-dispatch 450 even though the
    //     mission burned 50 at each of the 5 boundaries -- so refining REPLACED everything
    //     consumed (a pure drain would leave 450 - 250 = 200). Credit auto-buy is NOT the source
    //     (credits were 0 at dispatch), and the reserve was actually drawn down (proof below).
    expect(after.fuel.gte(450)).toBe(true);
    expect(after.inventory.deuteriumIce.lt(5000)).toBe(true); // ice WAS consumed into fuel
    // ...and mission rewards flowed (credits rose from the fresh 0), confirming cycles ran.
    expect(after.credits.gt(0)).toBe(true);
  });
});

describe("F3 (a) tank has enough -> spend, NO penalty, NO auto-buy", () => {
  it("auto-repeats without touching credits and with refuelDelayTicks 0 (orders stays 1 tick)", () => {
    let s = freshState();
    s.fuel = new Decimal(400); // under cap 500, covers dispatch + many repeats
    s.credits = new Decimal(1000);
    s = dispatchCaptainOnMission(s, 1, "shortOreRun").next; // fuel 400 -> 350, cycle 1 running
    expect(s.fuel.eq(350)).toBe(true);

    // Run one full cycle. No Deuterium Ice on hand (shortOreRun delivers Titanium, not ice, and
    // none was seeded), so the depot refines nothing -- the tank (350) simply covers the 50-fuel
    // repeat with NO auto-buy, NO penalty.
    const afterCycle = step(s, CYCLE_TICKS);
    // credits rose ONLY by the cycle reward (30) -- proof no auto-buy deducted.
    expect(afterCycle.credits.eq(1030)).toBe(true);
    // tank paid one repeat (350 -> 300); nothing refilled it.
    expect(afterCycle.fuel.eq(300)).toBe(true);
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
    s.fuel = new Decimal(NEED); // exactly one dispatch's worth (50) -> tank 0 after dispatch
    s.credits = new Decimal(2000);
    s = dispatchCaptainOnMission(s, 1, "shortOreRun").next; // fuel -> 0 (dispatch had enough: no penalty)
    expect(s.fuel.eq(0)).toBe(true);
    expect(s.captains[0].mission!.refuelDelayTicks ?? 0).toBe(0); // dispatch was fully fuelled

    // Run cycle 1 (149 ticks). No ice on hand, so the depot cannot top the tank -> at tick 149
    // the tank is 0 and the auto-repeat must auto-buy the full 50-fuel shortfall
    // (cost 50 * 20 = 1000 credits).
    const after = step(s, CYCLE_TICKS);
    // credits: 2000 + 30 (cycle-1 reward) - 1000 (auto-buy) = 1030.
    expect(after.credits.eq(1030)).toBe(true);
    expect(after.fuel.eq(0)).toBe(true); // bought 50, spent 50 -> net 0
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
    s.fuel = new Decimal(3); // short of the 50 need
    s.credits = new Decimal(2000); // shortfall 47 -> cost 47*20 = 940 -- affordable
    expect(canDispatch(s, 1, "shortOreRun")).toEqual({ ok: true });
  });

  it("dispatch auto-buys the shortfall, deducts credits, and stamps the +2 penalty on cycle 1", () => {
    let s = freshState();
    s.fuel = new Decimal(3); // shortfall 47
    s.credits = new Decimal(2000);
    const { next, success, reason } = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(success).toBe(true);
    expect(reason).toBeUndefined();
    expect(next.fuel.eq(0)).toBe(true); // 3 in tank + 47 bought - 50 spent = 0
    expect(next.credits.eq(1060)).toBe(true); // bought 47 units * 20 = 940 credits -> 2000 - 940
    expect(next.captains[0].mission!.refuelDelayTicks).toBe(REFUEL_PENALTY_TICKS);
  });
});

describe("F3 (c) truly broke -> hard-stop (dispatch blocked / auto-repeat ends)", () => {
  it("canDispatch blocks (fuelEmpty) when the tank is short AND the shortfall is unaffordable", () => {
    const s = freshState();
    s.fuel = new Decimal(0); // drain the default-full tank -- this test's SUBJECT is the broke, empty-tank floor
    s.credits = new Decimal(5); // shortfall 50 -> cost 1000 > 5 credits -> can't afford
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

describe("Fuel-sourcing restructure — the free localFuelRun bootstrap runs on 0 fuel + refines its ice", () => {
  it("dispatches on an EMPTY tank with 0 credits (0 fuel cost) and never fuel-stops", () => {
    let s = freshState();
    s.fuel = new Decimal(0); // fully drained -- proves the local run needs NO fuel
    s.credits = new Decimal(0); // ...and no credit auto-buy either
    const d = dispatchCaptainOnMission(s, 1, "localFuelRun");
    expect(d.success).toBe(true); // 0 fuel need -> dispatchable from a bricked fuel state
    expect(d.next.fuel.eq(0)).toBe(true); // spent nothing
    expect(d.next.captains[0].mission!.refuelDelayTicks ?? 0).toBe(0); // no shortfall -> no penalty
  });

  it("delivers Deuterium Ice ONLY, which the Fuel Depot then refines into fuel (the whole bootstrap loop)", () => {
    // Fresh game, tank drained to 0 so refining is VISIBLE (a full tank would just clip at cap).
    let s = freshState();
    s.fuel = new Decimal(0);
    s = dispatchCaptainOnMission(s, 1, "localFuelRun").next;

    // The localFuelRun cycle is 1 + 0 + 90 + 8 = 99 whole ticks (0-tick transit both ways).
    // Run one full cycle + margin so it delivers ~90 Deuterium Ice, then a few more ticks so
    // the Depot's first batch (50 ice -> 100 fuel over 10 ticks) completes.
    const afterDelivery = step(s, 99);
    // Ice was delivered (a positive Deuterium Ice balance appeared) -- and ONLY Deuterium Ice:
    // the generic uncommon/rare tiers stayed 0 (uncommonChance/rareChance are 0).
    expect((afterDelivery.inventory.deuteriumIce ?? new Decimal(0)).gt(0)).toBe(true);
    expect((afterDelivery.inventory.uncommonMaterial ?? new Decimal(0)).eq(0)).toBe(true);
    expect((afterDelivery.inventory.rareMaterial ?? new Decimal(0)).eq(0)).toBe(true);

    // Let the Depot refine that ice: fuel rises from 0, ice is consumed by the batch.
    const afterRefine = step(afterDelivery, 15);
    expect(afterRefine.fuel.gt(0)).toBe(true); // refining produced fuel from the mined ice
    // The mission is STILL auto-repeating (a 0-fuel local run never fuel-stops).
    expect(afterRefine.captains[0].mission).not.toBeNull();
  });
});

describe("⚠️ F3 REQUIRED offline==live PARITY — refining + consumption + auto-buy + penalty all fire", () => {
  // The controller re-verifies this personally. A multi-cycle span where the Fuel Depot refines
  // Deuterium Ice -> fuel, the mission burns fuel every cycle, the ice reserve RUNS OUT mid-span,
  // and once it does the drained tank forces an auto-buy + the +2-tick penalty. So all FOUR
  // mechanisms fire in ONE span. tick(bigSpan) (offline) must be bit-identical to looping
  // economyTick(_,1) (live) for fuel, credits, ice, and the captain's mission state.
  //
  // WHY the seed shape is what it is (post-restructure): with the fuel-ore decoupled from the
  // mission's own loot, a single shortOreRun no longer self-feeds its refinery. We SEED a SMALL
  // Deuterium Ice reserve (100 = exactly 2 batches -> +200 fuel, then ice-out). The tank starts
  // at 0 (dispatch drained it), refining lifts it to ~200 early, then the 50-fuel-per-cycle burn
  // drains it back to 0 within a few cycles -- and THAT boundary auto-buys (credits are ample, so
  // it never hard-stops). rng is a CONSTANT so loot interleaving can't perturb the comparison.
  const BIG_SPAN = 1000; // long enough that ice depletes, the tank drains, and an auto-buy fires
  const SEED_ICE = 100; // exactly 2 refine batches worth

  // Freshly dispatched, tank-empty-after-dispatch state with a small ice reserve + ample credits.
  // Built once per path so neither path mutates the other's input.
  const makeDispatched = (): GameState => {
    let s = withIce(freshState(), SEED_ICE);
    s = { ...s, fuel: new Decimal(NEED), credits: new Decimal(1_000_000) }; // tank -> 0 after dispatch; credits ample
    const d = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(d.success).toBe(true);
    return d.next;
  };

  const snap = (st: GameState) => {
    const m = st.captains[0].mission;
    return {
      fuel: st.fuel.toString(),
      credits: st.credits.toString(),
      ice: (st.inventory.deuteriumIce ?? new Decimal(0)).toString(),
      mission: m
        ? { phase: m.phase, progress: m.phaseProgressTicks, delay: m.refuelDelayTicks ?? 0, key: m.missionKey, recalled: m.recalled }
        : null,
      xp: st.captains[0].xp.toString(),
      level: st.captains[0].level,
    };
  };

  it("tick(bigSpan) == looping economyTick(_,1) bit-identical (auto-buy + penalty + refining fired)", () => {
    const offline = tick(BIG_SPAN, makeDispatched(), ALL_COMMON); // internally steps economyTick(_,1)

    // Live path: step one tick at a time, watching for the +2-tick refuel penalty to appear
    // (proof the auto-buy branch fired). Scanning per-tick avoids fragile boundary arithmetic.
    let live = makeDispatched();
    let sawPenalty = false;
    for (let i = 0; i < BIG_SPAN; i++) {
      live = economyTick(live, 1, ALL_COMMON);
      if ((live.captains[0].mission?.refuelDelayTicks ?? 0) > 0) sawPenalty = true;
    }

    // BIT-IDENTICAL across every fuel-affected field + mission state.
    expect(snap(offline)).toEqual(snap(live));

    // NON-VACUOUS proofs that all four mechanisms actually fired:
    //  - refining: the whole 100-ice reserve was consumed into fuel.
    expect((offline.inventory.deuteriumIce ?? new Decimal(0)).eq(0)).toBe(true);
    //  - consumption + auto-buy + penalty: a +2-tick refuel penalty was observed (auto-buy path).
    expect(sawPenalty).toBe(true);
    //  - the mission is still alive at span end (ample credits kept auto-buy funded).
    expect(offline.captains[0].mission).not.toBeNull();
  });
});
