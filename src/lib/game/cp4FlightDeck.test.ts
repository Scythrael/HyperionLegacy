// Complement plan CP-4's rest (user 2026-11-10 "Build it"; the plan: "it takes the Flight Deck Integrity facet when below
// half hull"): while the ship is below half hull, the Flight Deck's OWN Deck Handling (its crew and the Pilot) gains the
// Flight Deck's Integrity facet, x (1 + facet), frozen per patrol cycle beside the Deck Handling it lifts. Fix round (user
// 2026-11-11 "Flight Deck's own only"): Deck Handling from other seats, other departments or the captain is not lifted.

import { describe, expect, it } from "vitest";
import type { CrewBucket, GameState, PatrolMissionState } from "./model";
import { economyTick, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyDeckHandling, installedDronesForPatrol } from "./combat/bridge";
import { REPLENISH_PPM, deckHandlingPpmNow, replenishUnits } from "./combat/droneDefense";
import { shipDeckHandling, shipFlightDeckDeckHandling, shipFlightDeckIntegrityDeckHandling } from "./crewOverlay";
import { departmentFacet, officerStatFacet, officerStatTooltip, XO_DEPARTMENT_SHARE } from "./officerStats";
import { combatBase, seatOfficer } from "./wiring/probes";
import { CP4_FIXTURES, STAT_10, STAT_20, cp4Crewed, cp4Dispatched, flightBucket, steadyTick } from "./cp4FlightDeck.fixture";
import { withCp4FlightDeckOff } from "./cp4FlightDeckSwitch.fixture";
// WR-8b (enemy torpedoes) came after these tests were written (CP-4 was built on 717bba3; WR-8b merged in becc53ea):
// the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its pins and fixtures keep proving the Flight Deck's
// Integrity facet alone. With WR-8b live the Warband's Corsair Carrier torpedoes sink the held ramp 0.2 fixture in its
// first relaunched cycle, before its hull stands below half with a drone recovering. Traced 2026-11-11: on feat
// 2c66d749 and on this merge, with WR-8b switched off every fixture reproduces its capture hash for hash; WR-13 and
// OC-G1 move none of them. The torpedoes-on case is proven in cp4FlightDeck.test.ts ("with enemy torpedoes live").
import { enemyTorpedoesOffForThisFile, withEnemyTorpedoesOn } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();

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
    // User 2026-11-11 "Flight Deck's own only": the fixture XO is a Belter too, and its racial is Deck Handling from
    // another seat, so the Flight Deck's own part is the whole less the XO's racial (no amplifier aboard).
    const own = shipFlightDeckDeckHandling(s, ship);
    expect(own).toBeCloseTo(dh - 0.05, 12);
    const lift = shipFlightDeckIntegrityDeckHandling(s, ship);
    expect(lift).toBe(facet * own);
    const m = patrolOf(cp4Dispatched(CP4_FIXTURES.steady));
    expect(m.deckHandling).toBe(dh);
    expect(m.deckHandlingSteady).toBe(lift);
    expect(m.playerDrones.length).toBeGreaterThan(0);
    for (const sq of m.playerDrones) {
      expect(sq.deckHandlingPpm).toBe(Math.round(dh * REPLENISH_PPM));
      expect(sq.deckHandlingSteadyPpm).toBe(Math.round((dh + lift) * REPLENISH_PPM));
      // Not the whole pool x (1 + facet): the XO's share is not lifted.
      expect(sq.deckHandlingSteadyPpm).toBeLessThan(Math.round(dh * (1 + facet) * REPLENISH_PPM));
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

  it("the bank pays Deck Handling + the Flight Deck's lift below half hull and the plain Deck Handling above it", () => {
    const gear = combatBase("carrier").equipment.filter((e) => e.fittedToShipId === "ship-1");
    // The lift is the facet (0.14) x the Flight Deck's own Deck Handling (0.2 of the 0.25 aboard).
    const [dh, lift] = [0.25, 0.14 * 0.2];
    const sq = applyDeckHandling(installedDronesForPatrol(gear, "t"), dh, lift)[0];
    expect(sq.deckHandlingSteadyPpm).toBe(Math.round((dh + lift) * REPLENISH_PPM));
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
    expect(installedDronesForPatrol(gear, "t", undefined, dh, lift)).toEqual(applyDeckHandling(installedDronesForPatrol(gear, "t"), dh, lift));
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

  // WR-8b (enemy torpedoes) is live in the game: the file runs with it off so its pins prove the facet alone, and this
  // one test turns it ON. The Warband's Corsair Carriers carry the torpedo, which sinks the Balanced ramp 0.2 fixture in
  // its first relaunch (the measured Carrier Warband drop the user kept, 2026-11-10), so this run flies Defensive (its
  // point defense shoots some torpedoes down) held at ramp 0.1: a fight the carrier still wins while its hull falls below
  // half with a drone recovering.
  it("with enemy torpedoes live, the facet still lifts the Flight Deck's own Deck Handling below half hull", () => {
    withEnemyTorpedoesOn(() => {
      const s0 = cp4Crewed(CP4_FIXTURES.steady);
      const ship = s0.ships[0];
      const dh = shipDeckHandling(s0, ship);
      const facet = departmentFacet(s0, ship, "flightDeck", "integrity");
      const lift = shipFlightDeckIntegrityDeckHandling(s0, ship);
      expect(lift).toBe(facet * shipFlightDeckDeckHandling(s0, ship));
      expect(lift).toBeGreaterThan(0);
      const run = () => {
        let s = cp4Dispatched(CP4_FIXTURES.steady, s0, "standoff", 0.1);
        let seed = -1;
        let torpedoWaves: boolean[] = [];
        const r = { cycles: 0, stamped: 0, steady: 0, steadyAfterTorpedoes: 0, progress: 0, records: [] as PatrolMissionState[] };
        for (let i = 0; i < 3000; i++) {
          const m = s.captains[0].mission as PatrolMissionState | null;
          if (!m) break;
          if (m.masterSeed !== seed) {
            seed = m.masterSeed;
            r.cycles += 1;
            if (m.combatRules?.enemyTorpedoes === 1) r.stamped += 1;
            r.records.push(m);
            torpedoWaves = replayPatrol(s, s.captains[0]).waves.map((w) => w.enemyStart.some((e) => e.weapons.some((x) => x.weaponType === "concussionTorpedo")));
          }
          const hit = steadyTick(s);
          r.steady += hit;
          // The trigger reached after this cycle already fought a torpedo carrier.
          if (hit && torpedoWaves.slice(0, m.wavesWon + m.wavesLost).some(Boolean)) r.steadyAfterTorpedoes += 1;
          const before = hit ? m.playerDrones.flatMap((sq) => sq.drones.map((d) => d.refabProgress + d.repairProgress)) : [];
          s = economyTick(s, 1, rng);
          if (hit && s.captains[0].mission) {
            const after = patrolOf(s).playerDrones.flatMap((sq) => sq.drones.map((d) => d.refabProgress + d.repairProgress));
            r.progress += after.reduce((a, b, j) => a + Math.max(0, b - (before[j] ?? 0)), 0);
          }
        }
        return r;
      };
      const on = run();
      const off = withCp4FlightDeckOff(run);
      // Torpedoes really fly: every cycle is stamped with them, and the trigger is reached after a torpedo carrier fought.
      expect(on.cycles).toBeGreaterThan(1);
      expect(on.stamped).toBe(on.cycles);
      expect(on.steadyAfterTorpedoes).toBeGreaterThan(0);
      // Every cycle freezes the Flight Deck's own lift (not the pool x (1 + facet)), and the switched-off run freezes none.
      for (const m of on.records) {
        expect(m.deckHandling).toBe(dh);
        expect(m.deckHandlingSteady).toBe(lift);
        for (const sq of m.playerDrones) {
          expect(sq.deckHandlingSteadyPpm).toBe(Math.round((dh + lift) * REPLENISH_PPM));
          expect(sq.deckHandlingSteadyPpm!).toBeLessThan(Math.round(dh * (1 + facet) * REPLENISH_PPM));
        }
      }
      expect(off.records.every((m) => !("deckHandlingSteady" in m))).toBe(true);
      // Below half hull its drones recover more than the switched-off run's.
      expect(on.steady).toBeGreaterThan(0);
      expect(on.progress).toBeGreaterThan(off.progress);
    });
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
    expect(departmentFacet(s, s.ships[0], "flightDeck", "integrity")).toBeGreaterThan(0);
    const want = shipFlightDeckIntegrityDeckHandling(s, s.ships[0]);
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

  it("the Pilot's Integrity tooltip names the faster drone replenish below half hull, on the Flight Deck's own Deck Handling", () => {
    expect(officerStatTooltip("integrity", "pilot")).toMatch(/Deck Handling/);
    expect(officerStatTooltip("integrity", "pilot")).toMatch(/below half hull/i);
    expect(officerStatTooltip("integrity", "pilot")).toMatch(/the Flight Deck's own Deck Handling/);
  });

  // Fix round (user 2026-11-11 "Flight Deck's own only": "match the other Integrity bonuses"): a Belter in another seat,
  // Belter crew in another department and a Belter captain all add Deck Handling, and none of it takes the facet; the
  // Flight Deck's own crew and Pilot do.
  it("Deck Handling from another seat, another department or the captain is not lifted; the Flight Deck's own is", () => {
    const PILOT_20 = { race: "stationBorn" as const, stats: STAT_20 };
    const flight: CrewBucket = flightBucket("belter", "flight.droneHandling", 150);
    const security: CrewBucket = { ...flightBucket("belter", "sec.boarding", 100), profession: "security" };
    // The Flight Deck alone: a Station-born Pilot at Integrity 20 (no Deck Handling racial), its Belter Deck Handling crew.
    const crewed = (buckets: CrewBucket[]): GameState => {
      const s = seatOfficer(cp4Crewed({ ...CP4_FIXTURES.steady, integrity: STAT_10, race: "stationBorn" }), "pilot", [], PILOT_20);
      return { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active", buckets } } : sh)) };
    };
    const alone = crewed([flight]);
    const ship = (s: GameState) => s.ships[0];
    const facet = departmentFacet(alone, ship(alone), "flightDeck", "integrity");
    expect(facet).toBeCloseTo(officerStatFacet(STAT_20.integrity), 12);
    const own = shipFlightDeckDeckHandling(alone, ship(alone));
    expect(own).toBe(shipDeckHandling(alone, ship(alone)));
    expect(shipFlightDeckIntegrityDeckHandling(alone, ship(alone))).toBe(facet * own);
    const others: Record<string, GameState> = {
      // A Belter at Tactical (another seat): its racial is Deck Handling.
      tactical: seatOfficer(alone, "tactical", [], { race: "belter", stats: STAT_10 }),
      // A Belter XO at Integrity 10 (its share of the facet is 0): its own racial is another seat's.
      executive: seatOfficer(alone, "executive", [], { race: "belter", stats: STAT_10 }),
      // Belter crew in Security (another department): the Belter per-head racial.
      security: crewed([flight, security]),
      // A Belter captain commanding the ship.
      captain: { ...alone, captains: alone.captains.map((c, i) => (i === 0 ? { ...c, race: "belter" as const } : c)) },
    };
    for (const [name, s] of Object.entries(others)) {
      const dh = shipDeckHandling(s, ship(s));
      // The other source adds Deck Handling to the pool...
      expect(dh, name).toBeGreaterThan(own + 1e-9);
      // ...but the Flight Deck's own part, and the lift it takes, are unchanged.
      expect(shipFlightDeckDeckHandling(s, ship(s)), name).toBeCloseTo(own, 12);
      expect(shipFlightDeckIntegrityDeckHandling(s, ship(s)), name).toBeCloseTo(facet * own, 12);
      // Dispatched: below half hull the squadrons bank at the pool + the Flight Deck's lift, not the pool x (1 + facet).
      const m = patrolOf(cp4Dispatched(CP4_FIXTURES.steady, s));
      expect(m.deckHandling, name).toBe(dh);
      for (const sq of m.playerDrones) {
        expect(sq.deckHandlingSteadyPpm, name).toBe(Math.round((dh + m.deckHandlingSteady!) * REPLENISH_PPM));
        expect(sq.deckHandlingSteadyPpm!, name).toBeLessThan(Math.round(dh * (1 + facet) * REPLENISH_PPM));
      }
      expect(m.deckHandlingSteady!, name).toBeCloseTo(facet * own, 12);
    }
    // The captain really commands ship-1 (the guard above would pass vacuously otherwise).
    expect(others.captain.ships[0].assignedCaptainId).toBe(others.captain.captains[0].id);
  });
});
