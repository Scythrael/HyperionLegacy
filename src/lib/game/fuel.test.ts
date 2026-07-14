// Fuel data model tests — Mission Rework Task 3
// (docs/plans/2026-07-14-mission-rework-plan.md Task 3, design §3).
//
// Covers the fuel DATA MODEL only (no consumption / UI — those are Tasks 5/8):
//   - Every SHIP_TYPES hull carries the two new stats (fuelCapacity,
//     engineEfficiency) so no hull can ship without them.
//   - roundTripTransitTicks / fuelNeeded pure math: a known mission+hull value,
//     and the invariant that a more-efficient hull costs strictly less fuel.
//   - GameState.fuel seeds to Decimal 0 on a fresh save and survives a
//     serialize -> deserialize round trip as a live Decimal.
//   - Defensive hydration: a v20 save that predates the `fuel` field (pre-Task-9
//     migration) rehydrates to Decimal 0 instead of NaN / throwing.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import {
  SHIP_TYPES,
  MISSIONS,
  freshState,
  FUEL_PER_TICK,
  FUEL_CREDITS_PER_UNIT,
  FUEL_TANK_BASE_CAP,
} from "./model";
import { roundTripTransitTicks, fuelNeeded } from "./fuel";
import { fuelCap, buyFuel, dispatchCaptainOnMission, economyTick, tick } from "./tick";
import { serialize, deserialize, migrate, SAVE_VERSION, type SaveFile } from "./save";

describe("ship fuel stats", () => {
  it("gives every hull a numeric fuelCapacity and engineEfficiency", () => {
    for (const [key, def] of Object.entries(SHIP_TYPES)) {
      expect(typeof def.fuelCapacity, `${key}.fuelCapacity`).toBe("number");
      expect(def.fuelCapacity, `${key}.fuelCapacity`).toBeGreaterThan(0);
      expect(typeof def.engineEfficiency, `${key}.engineEfficiency`).toBe("number");
      // engineEfficiency is a 0-based bonus (0 = baseline 1:1), never negative.
      expect(def.engineEfficiency, `${key}.engineEfficiency`).toBeGreaterThanOrEqual(0);
    }
  });

  it("makes the Freighter the range hull (largest tank) and the Runner the most efficient", () => {
    // First-pass identity check so a future tuning pass can't silently invert the
    // intended hull profiles (Freighter = big tank/low eff, Runner = small tank/high eff).
    expect(SHIP_TYPES.generalFreighter.fuelCapacity).toBeGreaterThan(
      SHIP_TYPES.prospectorRunner.fuelCapacity
    );
    expect(SHIP_TYPES.prospectorRunner.engineEfficiency).toBeGreaterThan(
      SHIP_TYPES.generalFreighter.engineEfficiency
    );
  });
});

describe("fuel constants", () => {
  it("exposes the first-pass tunables", () => {
    expect(FUEL_PER_TICK).toBe(1);
    expect(FUEL_CREDITS_PER_UNIT).toBe(5);
  });
});

describe("roundTripTransitTicks", () => {
  it("sums the out + back transit phase ticks only", () => {
    // shortOreRun: transitOut 25 + transitBack 25 = 50. Extraction/unload/orders
    // are NOT transit and must not be counted.
    expect(roundTripTransitTicks(MISSIONS.shortOreRun)).toBe(50);
    expect(roundTripTransitTicks(MISSIONS.longOreRun)).toBe(140);
  });
});

describe("fuelNeeded", () => {
  it("returns roundTrip * FUEL_PER_TICK / (1 + engineEfficiency) for a known mission+hull", () => {
    // Freighter engineEfficiency 0 -> denominator 1 -> raw round-trip ticks.
    expect(fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter)).toBeCloseTo(50, 10);
  });

  it("costs a more-efficient hull strictly less fuel for the same mission", () => {
    const freighter = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.generalFreighter);
    const runner = fuelNeeded(MISSIONS.shortOreRun, SHIP_TYPES.prospectorRunner);
    expect(runner).toBeLessThan(freighter);
  });
});

describe("GameState.fuel", () => {
  it("seeds a fresh save to Decimal 0", () => {
    const state = freshState();
    expect(state.fuel).toBeInstanceOf(Decimal);
    expect(state.fuel.eq(0)).toBe(true);
  });

  it("survives a serialize -> deserialize -> migrate round trip as a live Decimal", () => {
    const state = freshState();
    state.fuel = new Decimal(42);
    const save = deserialize(serialize(state, 0));
    expect(save).not.toBeNull();
    const restored = migrate(save as SaveFile);
    expect(restored.fuel).toBeInstanceOf(Decimal);
    expect(restored.fuel.eq(42)).toBe(true);
  });

  it("defensively rehydrates a pre-migration save (no fuel field) to Decimal 0", () => {
    // A current-version save whose state predates the `fuel` field. The real
    // seeding migration is Task 9's job; hydrateDecimals must not NaN/throw before
    // then. Build the save shape by stripping `fuel` off a fresh serialized state.
    const save = deserialize(serialize(freshState(), 0)) as SaveFile;
    delete (save.state as any).fuel;
    expect(save.version).toBe(SAVE_VERSION);
    // migrate() runs no version steps (already current) then hydrateDecimals,
    // which must default the absent field rather than produce NaN.
    const restored = migrate(save);
    expect(restored.fuel).toBeInstanceOf(Decimal);
    expect(restored.fuel.eq(0)).toBe(true);
  });
});

// --- Task 4: fuel-storage facility cap + buyFuel ----------------------------
describe("fuelCap", () => {
  it("returns a POSITIVE base cap on a fresh state (no soft-lock — fuel buyable from start)", () => {
    // ⚠️ The critical no-soft-lock guarantee: missions are available from game
    // start and need fuel to dispatch, so the tank MUST hold fuel at facility
    // level 0. Unlike an un-built warehouse tier, fuelCap never returns a tiny /
    // sentinel value — a fresh fleet's cap is exactly FUEL_TANK_BASE_CAP.
    const state = freshState();
    const cap = fuelCap(state);
    expect(cap).toBeInstanceOf(Decimal);
    expect(cap.gt(0)).toBe(true);
    expect(cap.eq(FUEL_TANK_BASE_CAP)).toBe(true);
  });

  it("doubles the base cap once per reached fuelStorage level (base * 2^level)", () => {
    const state = freshState();
    state.facilities.fuelStorage = { level: 1 };
    expect(fuelCap(state).eq(FUEL_TANK_BASE_CAP * 2)).toBe(true);
    state.facilities.fuelStorage = { level: 3 };
    expect(fuelCap(state).eq(FUEL_TANK_BASE_CAP * 8)).toBe(true); // 500 * 2^3 = 4000
  });
});

describe("buyFuel", () => {
  it("deducts units * FUEL_CREDITS_PER_UNIT credits and adds units fuel (affordable + fits)", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(10)).toBe(true);
    expect(next.credits.eq(1000 - 10 * FUEL_CREDITS_PER_UNIT)).toBe(true); // 1000 - 50 = 950
    // Immutable: the ORIGINAL state is untouched.
    expect(state.fuel.eq(0)).toBe(true);
    expect(state.credits.eq(1000)).toBe(true);
  });

  it("clamps the purchase to remaining tank capacity (can't overfill)", () => {
    const state = freshState(); // cap = FUEL_TANK_BASE_CAP (500) at level 0
    state.credits = new Decimal(100000);
    state.fuel = new Decimal(FUEL_TANK_BASE_CAP - 5); // room for only 5 more
    const next = buyFuel(state, 100); // asked for 100, only 5 fit
    expect(next.fuel.eq(FUEL_TANK_BASE_CAP)).toBe(true); // filled exactly to cap
    // Charged only for the 5 units actually bought.
    expect(next.credits.eq(new Decimal(100000).minus(5 * FUEL_CREDITS_PER_UNIT))).toBe(true);
  });

  it("clamps the purchase to what the credits can afford (can't overspend / go negative)", () => {
    const state = freshState();
    state.credits = new Decimal(10); // affords exactly 10/5 = 2 units
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 100); // asked for 100, affords 2
    expect(next.fuel.eq(2)).toBe(true);
    expect(next.credits.eq(0)).toBe(true); // spent all, never negative
    expect(next.credits.gte(0)).toBe(true);
  });

  it("is a no-op when broke (0 credits)", () => {
    const state = freshState();
    state.credits = new Decimal(0);
    state.fuel = new Decimal(0);
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(0)).toBe(true);
    expect(next.credits.eq(0)).toBe(true);
  });

  it("is a no-op when the tank is already full", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(FUEL_TANK_BASE_CAP); // at cap already
    const next = buyFuel(state, 10);
    expect(next.fuel.eq(FUEL_TANK_BASE_CAP)).toBe(true);
    expect(next.credits.eq(1000)).toBe(true); // nothing spent
  });

  it("is a no-op for a non-positive request (no negative-units exploit)", () => {
    const state = freshState();
    state.credits = new Decimal(1000);
    state.fuel = new Decimal(100);
    const next = buyFuel(state, -5); // negative must not add credits / remove fuel
    expect(next.fuel.eq(100)).toBe(true);
    expect(next.credits.eq(1000)).toBe(true);
  });
});

// --- Task 5: fuel consumption at dispatch + auto-repeat stop-on-empty ----------
// (docs/plans/2026-07-14-mission-rework-plan.md Task 5, design §3/§7.)
//
// freshState() seeds a single captain flying the "ship-1" General Freighter
// (fuelCapacity 200, engineEfficiency 0), so fuelNeeded(shortOreRun, Freighter) is
// exactly (25+25)/(1+0) = 50 fuel per round trip -- an INTEGER, which is what makes
// the offline==live parity assertions below bit-exact (integer Decimal deductions
// carry no float drift). One shortOreRun cycle is 149 whole ticks (1 orders + 25 out
// + 90 extract + 25 back + 8 unload -- the same 149 the existing mission tests use).
const FREIGHTER_SHORT_RUN_FUEL = 50; // fuelNeeded(shortOreRun, generalFreighter)
const SHORT_RUN_CYCLE_TICKS = 149;

describe("dispatch fuel gate + spend (dispatchCaptainOnMission)", () => {
  it("BLOCKS dispatch (RESOURCE gate) when state.fuel < fuelNeeded, leaving state unchanged", () => {
    const state = freshState(); // fuel seeds to 0 on a fresh save
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(false); // 0 fuel can't cover the 50-fuel round trip
    expect(next).toBe(state); // same-ref no-op on failure (dispatch's own convention)
    expect(next.captains[0].mission).toBe(null); // captain stayed idle
    expect(next.fuel.eq(0)).toBe(true); // no fuel spent on a blocked dispatch
  });

  it("BLOCKS dispatch (RANGE gate) when the hull's fuelCapacity < fuelNeeded, even with a full tank", () => {
    // No real hull+mission combo trips the range gate today (every tank covers every
    // trip), so this exercises the forward-defensive branch by temporarily shrinking
    // the Runner's tank below a real mission's need, restoring it in finally.
    const state = freshState();
    state.fuel = new Decimal(1_000_000); // plenty of fuel -> isolate the RANGE gate from the RESOURCE gate
    state.ships = [{ id: "ship-1", typeKey: "prospectorRunner", assignedCaptainId: 1 }];
    const runnerLongRunNeed = fuelNeeded(MISSIONS.longOreRun, SHIP_TYPES.prospectorRunner);
    const originalCap = SHIP_TYPES.prospectorRunner.fuelCapacity;
    try {
      SHIP_TYPES.prospectorRunner.fuelCapacity = Math.floor(runnerLongRunNeed) - 1; // tank can't hold one trip's fuel
      const { next, success } = dispatchCaptainOnMission(state, 1, "longOreRun");
      expect(success).toBe(false); // range gate: fuelCapacity < need
      expect(next).toBe(state); // same-ref no-op
      expect(next.captains[0].mission).toBe(null);
      expect(next.fuel.eq(1_000_000)).toBe(true); // no fuel spent
    } finally {
      SHIP_TYPES.prospectorRunner.fuelCapacity = originalCap; // restore the shared table
    }
  });

  it("DEDUCTS fuelNeeded from the tank and dispatches on a successful gate pass", () => {
    const state = freshState();
    state.fuel = new Decimal(100); // covers the 50-fuel round trip with margin
    const { next, success } = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(success).toBe(true);
    expect(next.captains[0].mission?.missionKey).toBe("shortOreRun"); // dispatched
    expect(next.fuel.eq(100 - FREIGHTER_SHORT_RUN_FUEL)).toBe(true); // 50 spent at dispatch
  });
});

describe("auto-repeat stop-on-empty (economyTick)", () => {
  it("stops the auto-repeat and idles the captain (mission -> null) when the tank can't cover the next cycle", () => {
    // Tank sized for the dispatch (50) + exactly ONE repeat (50) = 100. After the
    // first cycle repeats (tank -> 0), the SECOND completion can't afford a third
    // cycle, so the mission ends. rng ()=>0 makes every extraction roll deterministic.
    let state = freshState();
    state.fuel = new Decimal(100);
    const dispatched = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(dispatched.success).toBe(true);
    state = dispatched.next; // fuel now 50, cycle 1 running
    // Step two full cycles' worth of ticks one economyTick(_,1) at a time.
    for (let i = 0; i < SHORT_RUN_CYCLE_TICKS * 2 + 5; i++) {
      state = economyTick(state, 1, () => 0);
    }
    expect(state.fuel.eq(0)).toBe(true); // dispatch 50 + one repeat 50 = tank drained
    expect(state.captains[0].mission).toBe(null); // stop-on-empty idled the captain
  });

  it("a fuel-RICH fleet is unaffected: the mission keeps repeating and never idles on fuel", () => {
    // A huge tank never trips the gate, so behavior is exactly the pre-fuel mission
    // engine: after 500 ticks the captain is still on a mission (mid cycle 4), not
    // idled. This is the anti-regression guarantee (enough fuel => unchanged).
    let state = freshState();
    state.fuel = new Decimal(1_000_000_000);
    const dispatched = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(dispatched.success).toBe(true);
    state = dispatched.next;
    for (let i = 0; i < 500; i++) {
      state = economyTick(state, 1, () => 0);
    }
    expect(state.captains[0].mission).not.toBe(null); // still running -- fuel never gated it
    // dispatch (1) + repeats at ticks 149/298/447 (3) = 4 round trips paid.
    expect(state.fuel.eq(1_000_000_000 - FREIGHTER_SHORT_RUN_FUEL * 4)).toBe(true);
  });
});

describe("⚠️ offline==live PARITY for a fuel-gated run (stop-on-empty mid-span)", () => {
  // THE required parity proof (design §7, controller re-verifies personally). A tank
  // sized to cover only a FEW cycles, dispatched, then stepped LONG ENOUGH that the
  // tank RUNS DRY and the auto-repeat STOPS mid-span. OFFLINE (one tick(bigSpan)) must
  // be bit-identical to LIVE (bigSpan hand-rolled economyTick(_,1) calls) for fuel,
  // captain mission state, delivered inventory, and credits. rng is a CONSTANT ()=>0
  // so the loot stream is deterministic and interleaving order can't matter.
  //
  // Fuel math (Freighter, 50/cycle): start 175 -> dispatch -50 -> 125 (cycle 1).
  // repeat @149 -> 75 (cycle 2); @298 -> 25 (cycle 3); @447 the tank (25) can't cover
  // a 4th cycle (50) -> STOP. So exactly 3 cycles complete, mission idles at tick 447,
  // final fuel 25. bigSpan 500 runs PAST the stop so the idle span is exercised too.
  const BIG_SPAN = 500;

  // Build a freshly-dispatched, fuel-gated state (called once per path so neither
  // path mutates the other's input).
  const makeDispatched = () => {
    const s = freshState();
    s.fuel = new Decimal(175); // covers dispatch + 2 repeats, then runs dry on the 3rd completion
    const { next, success } = dispatchCaptainOnMission(s, 1, "shortOreRun");
    expect(success).toBe(true); // 175 >= 50, dispatch pays the first cycle -> fuel 125
    return next;
  };

  it("tick(bigSpan) == looping economyTick(_,1) across the tank running dry mid-span", () => {
    const offline = tick(BIG_SPAN, makeDispatched(), () => 0);

    let live = makeDispatched();
    for (let i = 0; i < BIG_SPAN; i++) {
      live = economyTick(live, 1, () => 0);
    }

    // NON-VACUOUS: prove the stop-on-empty actually fired mid-span (mission idled,
    // tank at the 25 residue that couldn't cover a 4th cycle).
    expect(offline.captains[0].mission).toBe(null);
    expect(live.captains[0].mission).toBe(null);
    expect(offline.fuel.eq(25)).toBe(true);

    // BIT-IDENTICAL offline vs live across every fuel-affected field.
    expect(offline.fuel.equals(live.fuel)).toBe(true);
    expect(offline.credits.equals(live.credits)).toBe(true);
    // 3 completed cycles x 10 credits/cycle = 30 (freshState credits start at 0).
    expect(offline.credits.eq(30)).toBe(true);
    // rng ()=>0 wins the rare tier every extraction tick (0 < rareChance 0.001), so all
    // loot lands in rareMaterial: 90 rolls/cycle x 3 delivered cycles = 270.
    const offRare = offline.inventory.rareMaterial ?? new Decimal(0);
    const liveRare = live.inventory.rareMaterial ?? new Decimal(0);
    expect(offRare.equals(liveRare)).toBe(true);
    expect(offRare.eq(270)).toBe(true); // non-vacuous: 3 cycles' worth actually delivered
    // Captain XP + level must also match across the two paths (whole-tick accrual).
    expect(offline.captains[0].xp.equals(live.captains[0].xp)).toBe(true);
    expect(offline.captains[0].level).toBe(live.captains[0].level);
  });
});
