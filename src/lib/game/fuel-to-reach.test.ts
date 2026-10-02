// fuel-to-reach.test.ts — 0.13.6 FUEL-TO-REACH (build plan:
// docs/plans/2026-09-16-fuel-to-reach-0.13.6-plan.md).
//
// Pins the parity / no-elevation guarantee: the lightyear REACH gate (canReach) is exactly the old
// capacity gate (fuelCapacity >= fuelNeeded) relabelled, so pulling fuel-to-reach in changes NO
// ship/mission eligibility. If a future edit drifts the gate, this fails.
import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { SHIP_TYPES, MISSIONS, PATROLS, freshState } from "./model";
import { fuelNeeded, fuelForRoundTrip, canReach, distanceLightYears, rangeLightYears, LY_PER_TICK } from "./fuel";
import { dispatchCaptainOnMission, economyTick, shipReachDef, shipReachesRoundTrip, shipRangeLightYears } from "./tick";

describe("fuel-to-reach: the lightyear gate equals the old capacity gate (parity)", () => {
  it("canReach(mission, ship) === (fuelCapacity >= fuelNeeded) for EVERY ship x mission", () => {
    for (const [shipKey, ship] of Object.entries(SHIP_TYPES)) {
      for (const [missionKey, mission] of Object.entries(MISSIONS)) {
        const oldGate = ship.fuelCapacity >= fuelNeeded(mission, ship);
        expect(canReach(mission, ship), `${shipKey} x ${missionKey}`).toBe(oldGate);
      }
    }
  });

  it("distance is mission-intrinsic (round-trip transit x LY_PER_TICK)", () => {
    for (const mission of Object.values(MISSIONS)) {
      const rt = mission.transitOutTicks + mission.transitBackTicks;
      expect(distanceLightYears(mission)).toBeCloseTo(rt * LY_PER_TICK, 9);
    }
  });

  it("range folds engine efficiency (a more efficient hull reaches further on the same tank)", () => {
    // Two hulls, same tank, different efficiency -> the efficient one has the longer range.
    const a = { fuelCapacity: 100, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    const b = { fuelCapacity: 100, engineEfficiency: 0.5 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    expect(rangeLightYears(b)).toBeGreaterThan(rangeLightYears(a));
    expect(rangeLightYears(a)).toBeCloseTo(100 * 1 * LY_PER_TICK, 9);
    expect(rangeLightYears(b)).toBeCloseTo(100 * 1.5 * LY_PER_TICK, 9);
  });

  it("a bigger tank reaches further, and a zero-distance local run is always reachable", () => {
    const small = { fuelCapacity: 100, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    const big = { fuelCapacity: 300, engineEfficiency: 0 } as (typeof SHIP_TYPES)[keyof typeof SHIP_TYPES];
    expect(rangeLightYears(big)).toBeGreaterThan(rangeLightYears(small));
    const localRun = { transitOutTicks: 0, transitBackTicks: 0 } as (typeof MISSIONS)[keyof typeof MISSIONS];
    expect(distanceLightYears(localRun)).toBe(0);
    expect(canReach(localRun, small)).toBe(true);
  });
});

describe("fuel-to-reach: fuel no longer depletes and never fuel-stops a captain", () => {
  it("dispatch + 500 economy ticks on a near-empty tank leave fuel unchanged and never fuel-stop", () => {
    // A tiny tank would have hard-stopped the captain on fuel in the old economy. Now fuel is a
    // range stat only: it never drains and never idles a captain, so the tank is untouched and no
    // captain ever carries a "fuel" stop reason.
    let state = freshState();
    state = { ...state, fuel: new Decimal(1) }; // near-empty: irrelevant to the reach gate
    const dispatched = dispatchCaptainOnMission(state, 1, "shortOreRun");
    expect(dispatched.success).toBe(true); // reach (capacity) covers it regardless of the tank
    state = dispatched.next;
    for (let i = 0; i < 500; i++) state = economyTick(state, 1, () => 0.5);
    expect(state.fuel.eq(1)).toBe(true); // the tank never drained (instant free refuel)
    expect(state.captains.every((c) => c.lastStopReason !== "fuel")).toBe(true); // never fuel-stopped
  });
});

// 0.13.9 hotfix: ONE gear-inclusive reach reading for a real ship. The gates read the
// equipment-folded fuel capacity + efficiency while the range readouts used to show the bare
// hull's numbers, so an installed FTL Drive could make the popup show a range SHORTER than the
// trip while the dispatch was still allowed. Both now go through shipReachDef.
describe("fuel-to-reach: shipRangeLightYears / shipReachesRoundTrip (0.13.9)", () => {
  // freshState's ship-1 with its installed FTL Drive carrying an extra +300 Fuel Capacity affix.
  function boostedFleet() {
    const s = freshState();
    const ship = s.ships[0];
    const equipment = s.equipment.map((e) =>
      e.fittedToShipId === ship.id && e.slotType === "ftlDrive"
        ? { ...e, rolledStats: { ...e.rolledStats, fuelCapacity: (e.rolledStats.fuelCapacity ?? 0) + 300 } }
        : e
    );
    return { state: { ...s, equipment }, ship };
  }

  it("the range readout INCLUDES installed gear (not the bare hull's number)", () => {
    const { state, ship } = boostedFleet();
    const bare = rangeLightYears(SHIP_TYPES[ship.typeKey]);
    expect(shipRangeLightYears(state, ship)).toBeCloseTo(bare + 300 * (1 + SHIP_TYPES[ship.typeKey].engineEfficiency) * LY_PER_TICK, 9);
    expect(shipRangeLightYears(state, ship)).toBeGreaterThan(bare);
  });

  it("the gate helper equals the old inline gate AND agrees with the lightyear readout, for every mission and patrol", () => {
    const { state, ship } = boostedFleet();
    const def = shipReachDef(state, ship);
    const trips: [string, number, number][] = [
      ...Object.entries(MISSIONS).map(([k, m]) => [k, m.transitOutTicks, m.transitBackTicks] as [string, number, number]),
      ...Object.entries(PATROLS).map(([k, p]) => [k, p.transitOutTicks, p.transitBackTicks] as [string, number, number]),
    ];
    for (const [key, out, back] of trips) {
      const gate = shipReachesRoundTrip(state, ship, out, back);
      // Byte-identical to the pre-0.13.9 inline check (folded capacity vs folded-efficiency need).
      expect(gate, `${key}: old inline gate`).toBe(def.fuelCapacity >= fuelForRoundTrip(out, back, def));
      // And the readout the player sees tells the same story (range covers the round-trip distance).
      expect(gate, `${key}: readout`).toBe(shipRangeLightYears(state, ship) >= (out + back) * LY_PER_TICK);
    }
  });
});
