// Complement plan CP-4's rest (user 2026-11-10 "Build it"; the plan: "it takes the Flight Deck Integrity facet when below
// half hull"): while the ship is below half hull, its Deck Handling (the Flight Deck crew's drone replenish) gains the
// Flight Deck's Integrity facet, x (1 + facet), frozen per patrol cycle beside the Deck Handling it lifts.

import { describe, expect, it } from "vitest";
import type { GameState, PatrolMissionState } from "./model";
import { economyTick, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyDeckHandling, installedDronesForPatrol } from "./combat/bridge";
import { REPLENISH_PPM, deckHandlingPpmNow, replenishUnits } from "./combat/droneDefense";
import { shipDeckHandling } from "./crewOverlay";
import { departmentFacet, officerStatFacet, officerStatTooltip, XO_DEPARTMENT_SHARE } from "./officerStats";
import { combatBase } from "./wiring/probes";
import { CP4_FIXTURES, STAT_20, cp4Crewed, cp4Dispatched, steadyTick } from "./cp4FlightDeck.fixture";
import { withCp4FlightDeckOff } from "./cp4FlightDeckSwitch.fixture";

const patrolOf = (s: GameState): PatrolMissionState => s.captains[0].mission as PatrolMissionState;
const rng = () => 0.5;

describe("CP-4's rest: the Flight Deck's Integrity on Deck Handling, below half hull", () => {
  it("the dispatch freezes the facet beside the Deck Handling, and every squadron carries its below-half rate", () => {
    const s = cp4Crewed(CP4_FIXTURES.steady);
    const ship = s.ships[0];
    const facet = departmentFacet(s, ship, "flightDeck", "integrity");
    // The Pilot's facet plus the XO's share (both at Integrity 20): the first-pass 1% per point above 10.
    expect(facet).toBeCloseTo(officerStatFacet(STAT_20.integrity) * (1 + XO_DEPARTMENT_SHARE), 12);
    const dh = shipDeckHandling(s, ship);
    expect(dh).toBeGreaterThan(0);
    const m = patrolOf(cp4Dispatched(CP4_FIXTURES.steady));
    expect(m.deckHandling).toBe(dh);
    expect(m.deckHandlingSteady).toBe(facet);
    expect(m.playerDrones.length).toBeGreaterThan(0);
    for (const sq of m.playerDrones) {
      expect(sq.deckHandlingPpm).toBe(Math.round(dh * REPLENISH_PPM));
      expect(sq.deckHandlingSteadyPpm).toBe(Math.round(dh * (1 + facet) * REPLENISH_PPM));
    }
  });

  it("nothing is stamped without the facet, without Deck Handling, without drones, or with the switch off", () => {
    for (const key of ["neutral", "noDeck", "noDrones"] as const) {
      const m = patrolOf(cp4Dispatched(CP4_FIXTURES[key]));
      expect("deckHandlingSteady" in m, key).toBe(false);
      expect(m.playerDrones.every((sq) => sq.deckHandlingSteadyPpm === undefined), key).toBe(true);
    }
    withCp4FlightDeckOff(() => {
      const m = patrolOf(cp4Dispatched(CP4_FIXTURES.steady));
      expect("deckHandlingSteady" in m).toBe(false);
      expect(m.playerDrones.every((sq) => sq.deckHandlingSteadyPpm === undefined)).toBe(true);
    });
  });

  it("the bank pays Deck Handling x (1 + facet) below half hull and the plain Deck Handling above it", () => {
    const gear = combatBase("carrier").equipment.filter((e) => e.fittedToShipId === "ship-1");
    const [dh, facet] = [0.25, 0.14];
    const sq = applyDeckHandling(installedDronesForPatrol(gear, "t"), dh, facet)[0];
    expect(sq.deckHandlingSteadyPpm).toBe(Math.round(dh * (1 + facet) * REPLENISH_PPM));
    const down = () => ({ ...sq, drones: sq.drones.map((d) => ({ ...d, alive: false })) });
    const ticks = 10_000;
    const pay = (below: boolean) => {
      const one = down();
      let units = 0;
      for (let t = 0; t < ticks; t++) units += replenishUnits(one, below);
      return units;
    };
    const rate = sq.droneReplenishRate;
    expect(pay(false)).toBe(ticks * rate + Math.floor((ticks * rate * sq.deckHandlingPpm!) / REPLENISH_PPM));
    expect(pay(true)).toBe(ticks * rate + Math.floor((ticks * rate * sq.deckHandlingSteadyPpm!) / REPLENISH_PPM));
    // Peace: below half hull never pays less than above it.
    expect(pay(true)).toBeGreaterThan(pay(false));
    // Without the stamp the flag changes nothing.
    const plain = applyDeckHandling(installedDronesForPatrol(gear, "t"), dh)[0];
    expect(deckHandlingPpmNow(plain, true)).toBe(deckHandlingPpmNow(plain, false));
    expect(installedDronesForPatrol(gear, "t", undefined, dh, facet)).toEqual(applyDeckHandling(installedDronesForPatrol(gear, "t"), dh, facet));
  });

  it("the steady patrol reaches the trigger, and its drones recover more there than the switched-off run's", () => {
    const run = () => {
      let s = cp4Dispatched(CP4_FIXTURES.steady);
      let steady = 0;
      let progress = 0;
      for (let i = 0; i < 3000; i++) {
        const hit = steadyTick(s);
        steady += hit;
        const before = hit ? patrolOf(s).playerDrones.flatMap((sq) => sq.drones.map((d) => d.refabProgress + d.repairProgress)) : [];
        s = economyTick(s, 1, rng);
        if (hit && s.captains[0].mission) {
          const after = patrolOf(s).playerDrones.flatMap((sq) => sq.drones.map((d) => d.refabProgress + d.repairProgress));
          progress += after.reduce((a, b, j) => a + Math.max(0, b - (before[j] ?? 0)), 0);
        }
      }
      return { steady, progress };
    };
    const on = run();
    const off = withCp4FlightDeckOff(run);
    expect(on.steady).toBeGreaterThan(0);
    expect(on.progress).toBeGreaterThan(off.progress);
  });

  it("replay == live with the facet: every won wave's hull, shield and drone screen agree", () => {
    // From the first relaunch: the dispatched cycle keeps the wave plan its dispatch made before the fixture held its
    // stamp (cp4Dispatched), so only a relaunched cycle is planned and fought at the held point of the curve.
    let s = cp4Dispatched(CP4_FIXTURES.steady);
    const firstSeed = patrolOf(s).masterSeed;
    while (s.captains[0].mission && patrolOf(s).masterSeed === firstSeed) s = economyTick(s, 1, rng);
    let checked = 0;
    let sawSteady = false;
    for (let cycle = 1; cycle < 8; cycle++) {
      const seed = patrolOf(s).masterSeed;
      const replay = replayPatrol(s, s.captains[0]);
      expect(replay.available).toBe(true);
      const won = replay.waves.filter((w) => w.playerWon);
      const live: { hull: number; shield: number; drones: string }[] = [];
      let prev = 0;
      while (s.captains[0].mission && patrolOf(s).masterSeed === seed) {
        if (steadyTick(s)) sawSteady = true;
        s = economyTick(s, 1, rng);
        const m = s.captains[0].mission as PatrolMissionState | null;
        if (m && m.masterSeed === seed && m.wavesWon > prev) {
          live.push({ hull: m.playerHull, shield: m.playerShield, drones: JSON.stringify(m.playerDrones.map((sq) => sq.drones)) });
          prev = m.wavesWon;
        }
      }
      expect(live.length, `cycle ${cycle}`).toBe(won.length);
      won.forEach((w, i) =>
        expect({ hull: w.playerEnd?.hull, shield: w.playerEnd?.shield, drones: JSON.stringify(w.playerEnd?.drones.map((sq) => sq.drones)) }, `cycle ${cycle} wave ${i}`).toEqual(live[i]),
      );
      checked += won.length;
      if (!s.captains[0].mission) break;
    }
    expect(checked).toBeGreaterThan(0);
    expect(sawSteady).toBe(true);
  });

  it("offline == live: one tick() call, 997 s chunks and 1 s ticks give the same patrol", () => {
    const s0 = cp4Dispatched(CP4_FIXTURES.steady);
    const once = tick(2991, s0, rng);
    const chunks = tick(997, tick(997, tick(997, s0, rng), rng), rng);
    let ones = s0;
    for (let i = 0; i < 2991; i++) ones = tick(1, ones, rng);
    expect(chunks.captains).toEqual(once.captains);
    expect(ones.captains).toEqual(once.captains);
  });

  it("a patrol in flight from before the facet (no stamp) flies and replays exactly as before", () => {
    // Flown with the switch off (the records an older build wrote) until a cycle stands at the trigger: hull below half
    // with a drone recovering. That cycle carries no stamp.
    let old = withCp4FlightDeckOff(() => cp4Dispatched(CP4_FIXTURES.steady));
    withCp4FlightDeckOff(() => {
      for (let i = 0; i < 3000 && !steadyTick(old); i++) old = economyTick(old, 1, rng);
    });
    expect(steadyTick(old)).toBe(1);
    expect("deckHandlingSteady" in patrolOf(old)).toBe(false);
    // The rest of that cycle, flown on this build and on the old rules: identical tick by tick, and so is its replay.
    const seed = patrolOf(old).masterSeed;
    let live = old;
    let before = old;
    let ticks = 0;
    while (live.captains[0].mission && patrolOf(live).masterSeed === seed) {
      live = economyTick(live, 1, rng);
      before = withCp4FlightDeckOff(() => economyTick(before, 1, rng));
      if (!live.captains[0].mission || patrolOf(live).masterSeed !== seed) break;
      expect(live.captains).toEqual(before.captains);
      ticks += 1;
    }
    expect(ticks).toBeGreaterThan(0);
    expect(replayPatrol(old, old.captains[0])).toEqual(withCp4FlightDeckOff(() => replayPatrol(old, old.captains[0])));
  });

  it("a relaunch freezes the Flight Deck's Integrity aboard THEN", () => {
    let s = cp4Dispatched(CP4_FIXTURES.neutral);
    expect(patrolOf(s).deckHandlingSteady).toBeUndefined();
    // Raise the seated Pilot's Integrity mid-run: the running cycle keeps its record, the next one freezes the new facet.
    s = { ...s, officers: s.officers.map((o) => (o.seat === "pilot" ? { ...o, stats: { ...STAT_20 } } : o)) };
    const want = departmentFacet(s, s.ships[0], "flightDeck", "integrity");
    expect(want).toBeGreaterThan(0);
    const seed = patrolOf(s).masterSeed;
    let relaunched = false;
    for (let i = 0; i < 2000 && !relaunched; i++) {
      s = economyTick(s, 1, rng);
      if (!s.captains[0].mission) break;
      if (patrolOf(s).masterSeed !== seed) relaunched = true;
      else expect(patrolOf(s).deckHandlingSteady).toBeUndefined();
    }
    expect(relaunched).toBe(true);
    expect(patrolOf(s).deckHandlingSteady).toBe(want);
  });

  it("the Pilot's Integrity tooltip names the faster drone replenish below half hull", () => {
    expect(officerStatTooltip("integrity", "pilot")).toMatch(/Deck Handling/);
    expect(officerStatTooltip("integrity", "pilot")).toMatch(/below half hull/i);
  });
});
