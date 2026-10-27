// The four inert racials go live (0.14.0, user "everything wired" 2026-10-20; merge-batch answers "Relics v2 constants
// and Spacer" and "Spacer bonus"; complement plan OC-1 "Faster drone replenish", OC-4 "Faster scans"):
//   Belter (crew.droneHandling, with the Flight Deck's Deck Handling): a patrol cycle's drone replenish rate
//     x (1 + it), frozen per cycle on PatrolMissionState.deckHandling;
//   Vael and Outer-Colony (crew.surveyAptitude, with the Science division's Survey Aptitude): the expedition's
//     scanSpeedBonus, frozen at dispatch;
//   Spacer: the sweeping transit speed (both mission legs and the voyage).
// The goldens and the "turn it off" proof are racialsGoldens.test.ts; the registry's sensitivity level checks each
// racial's magnitude through its consumer (wiring.sensitivity.test.ts). This file pins the shapes: who reads what,
// when it freezes, offline == live, and the captain's racial passing the crew-key guard.

import { describe, expect, it } from "vitest";
import { asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { freshState, outboundLegSpeed, returnLegSpeed, type CaptainState, type CrewBucket, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyDeckHandling, installedDronesForPatrol } from "./combat/bridge";
import { REPLENISH_PPM, replenishUnits } from "./combat/droneDefense";
import { expeditionCandidates } from "./expedition";
import { crewRepairSpeedBonus, effectiveShipStats, shipCrewContribution, shipDeckHandling, shipSurveyAptitude } from "./crewOverlay";
import { CREW_STAT_KEYS, TRANSIT_SPEED_KEY } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { combatBase, editCaptain, seatOfficer, withAwayTeam, wiringBase } from "./wiring/probes";
// Gear wear step 4 (0.14.0): these racial checks predate battle wear (a long Repeat patrol now wears its ship down over
// its cycles), so the file runs with the battle sources off (battleWearSwitch.fixture.ts).
import { battleWearOffInThisFile } from "./battleWearSwitch.fixture";
battleWearOffInThisFile();

const bucket = (profession: CrewBucket["profession"], race: CrewBucket["race"], buff1Id: string, count: number): CrewBucket => ({
  profession,
  rarity: "standard",
  rank: 1,
  race,
  buff1Id,
  buff2Id: null,
  count,
});
const withCrew = (s: GameState, buckets: CrewBucket[]): GameState => ({
  ...s,
  ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active", buckets } } : sh)),
});
const patrolOf = (s: GameState): PatrolMissionState => s.captains[0].mission as PatrolMissionState;
function dispatched(s: GameState, repeat = false): GameState {
  const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverSweep", "balanced", repeat);
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  return r.next;
}

describe("Belter + Deck Handling: a patrol cycle's drones replenish faster", () => {
  const belterXo = (s: GameState) => seatOfficer(s, "executive", [], { race: "belter" });

  it("the dispatch freezes the crew's Deck Handling and seeds every squadron with it (parts per million)", () => {
    const off = patrolOf(dispatched(combatBase("carrier")));
    const s = withCrew(belterXo(combatBase("carrier")), [bucket("flightDeck", "belter", "flight.droneHandling", 40)]);
    const dh = shipDeckHandling(s, s.ships[0]);
    // The officer racial (0.05) + 40 heads of Deck Handling (0.0015) and their Belter racial (0.0005).
    expect(dh).toBeCloseTo(CREW_RACES.belter.racialBonus.seniorStaff + 40 * (0.0015 + CREW_RACES.belter.racialBonus.complement), 12);
    expect(dh).toBe(shipCrewContribution(s, s.ships[0])[CREW_STAT_KEYS.droneHandling]);
    const on = patrolOf(dispatched(s));
    expect(on.deckHandling).toBe(dh);
    expect(off.deckHandling).toBeUndefined();
    expect(on.playerDrones.length).toBe(off.playerDrones.length);
    expect(on.playerDrones.length).toBeGreaterThan(0);
    on.playerDrones.forEach((sq) => expect(sq.deckHandlingPpm).toBe(Math.round(dh * REPLENISH_PPM)));
    // The rate itself, drone hit points and damage are untouched (D12: replenishment only, banked).
    on.playerDrones.forEach((sq, i) => expect({ ...sq, deckHandlingPpm: undefined }).toEqual({ ...off.playerDrones[i], deckHandlingPpm: undefined }));
  });

  it("the bank pays the extra whole units: rate x (1 + it) over a long recovery, and nothing while every drone is up", () => {
    const sq = { ...applyDeckHandling(installedDronesForPatrol(combatBase("carrier").equipment.filter((e) => e.fittedToShipId === "ship-1"), "t"), 0.0005)[0] };
    expect(sq.deckHandlingPpm).toBe(500); // one Belter crewman's racial
    expect(replenishUnits(sq)).toBe(sq.droneReplenishRate); // all online: no bank
    expect(sq.replenishCarryPpm).toBeUndefined();
    const down = { ...sq, drones: sq.drones.map((d) => ({ ...d, alive: false })) };
    let units = 0;
    const ticks = 10_000;
    for (let t = 0; t < ticks; t++) units += replenishUnits(down);
    expect(units).toBe(ticks * sq.droneReplenishRate + Math.floor((ticks * sq.droneReplenishRate * 500) / REPLENISH_PPM));
    expect(units).toBeGreaterThan(ticks * sq.droneReplenishRate);
  });

  it("ONE Belter crewman moves the replenish over a long Repeat patrol (the bank carries across relaunches)", () => {
    const one = [bucket("flightDeck", "belter", "flight.transitOut", 1)];
    const run = (s0: GameState) => {
      // SF-4 (one step per patrol run): a fresh save's Repeat run would stay at the curve's floor, where no drone is
      // lost; a patrol veteran flies the full-strength fight this replenish test is about.
      let s = dispatched(asPatrolVeteran(s0), true);
      let prev = patrolOf(s).playerDrones.map((sq) => sq.replenishCarryPpm ?? 0);
      let paid = 0;
      let carriedOver = false;
      for (let i = 0; i < 20_000; i++) {
        const seed = patrolOf(s).masterSeed;
        s = economyTick(s, 1, () => 0.5);
        const m = patrolOf(s);
        const now = m.playerDrones.map((sq) => sq.replenishCarryPpm ?? 0);
        if (now.some((c, j) => c < (prev[j] ?? 0))) paid += 1; // the bank released a whole unit
        if (m.masterSeed !== seed && (m.replenishCarryStart ?? []).some((c) => c > 0)) carriedOver = true;
        prev = now;
      }
      return { s, paid, carriedOver };
    };
    const belter = run(withCrew(combatBase("carrier"), one));
    expect(patrolOf(belter.s).deckHandling).toBe(CREW_RACES.belter.racialBonus.complement);
    expect(belter.carriedOver).toBe(true);
    expect(belter.paid).toBeGreaterThan(0);
    // The same patrol with a crewman of another race replenishes on the plain rate only.
    const control = run(withCrew(combatBase("carrier"), [bucket("flightDeck", "spacer", "flight.transitOut", 1)]));
    expect(control.paid).toBe(0);
    expect(patrolOf(control.s).playerDrones.every((sq) => sq.deckHandlingPpm === undefined)).toBe(true);
    // And the display replay of the cycle in flight seeds the bank the live cycle started with (replenishCarryStart).
    const replay = replayPatrol(belter.s, belter.s.captains[0]);
    expect(replay.available).toBe(true);
    const start = patrolOf(belter.s).replenishCarryStart;
    if (start) expect(JSON.stringify(replay)).toContain(`"replenishCarryPpm":`);
  });

  it("a hull without drones keeps an empty screen; a ship without the key writes nothing", () => {
    const s = belterXo(combatBase("destroyer"));
    expect(patrolOf(dispatched(s)).playerDrones).toEqual([]);
    expect("deckHandling" in patrolOf(dispatched(s))).toBe(false); // nothing to replenish, nothing stored
    const plain = combatBase("carrier");
    expect(shipDeckHandling(plain, plain.ships[0])).toBe(0);
    expect("deckHandling" in patrolOf(dispatched(plain))).toBe(false);
    expect(applyDeckHandling([], 0.5)).toEqual([]);
  });

  it("a relaunch freezes the crew aboard THEN (the next cycle), the display replay reads the cycle's frozen value", () => {
    let s = dispatched(belterXo(combatBase("carrier")), true);
    const first = patrolOf(s);
    expect(first.deckHandling).toBe(CREW_RACES.belter.racialBonus.seniorStaff);
    // A Deck Handling bench boards mid-cycle: the running cycle keeps its value, the relaunch takes the new one.
    s = withCrew(s, [bucket("flightDeck", "belter", "flight.droneHandling", 40)]);
    const want = shipDeckHandling(s, s.ships[0]);
    let relaunched = false;
    for (let i = 0; i < 1200 && !relaunched; i++) {
      const seed = patrolOf(s).masterSeed;
      s = economyTick(s, 1, () => 0.5);
      if (patrolOf(s).masterSeed !== seed) relaunched = true;
      else expect(patrolOf(s).deckHandling).toBe(first.deckHandling);
    }
    expect(relaunched).toBe(true);
    expect(patrolOf(s).deckHandling).toBe(want);
    // The replay seeds the screen from the stored mission's frozen value (not the crew aboard now): the same mission
    // without it replays differently.
    const replay = replayPatrol(s, s.captains[0]);
    expect(replay.available).toBe(true);
    const { deckHandling: _dh, ...without } = patrolOf(s);
    const stripped = { ...s, captains: s.captains.map((c, i) => (i === 0 ? { ...c, mission: without } : c)) };
    expect(replayPatrol(stripped, stripped.captains[0])).not.toEqual(replay);
  });

  it("replay == live with a heavy Deck Handling bank: every won wave's hull, shield and drone screen agree", () => {
    for (const seed of [1, 3, 5, 7, 11]) {
      const crew = [bucket("flightDeck", "belter", "flight.droneHandling", 400)];
      let s = dispatched({ ...withCrew(belterXo(combatBase("carrier")), crew), nextPatrolSeed: seed });
      const replay = replayPatrol(s, s.captains[0]);
      const won = replay.waves.filter((w) => w.playerWon);
      const live: { hull: number; shield: number }[] = [];
      let prev = 0;
      for (let i = 0; i < 60; i++) {
        s = economyTick(s, 1, () => 0.5);
        const m = s.captains[0].mission as PatrolMissionState | null;
        if (m && m.wavesWon > prev) {
          live.push({ hull: m.playerHull, shield: m.playerShield });
          prev = m.wavesWon;
        }
      }
      expect(live.length, `seed ${seed}`).toBe(won.length);
      won.forEach((w, i) => expect({ hull: w.playerEnd?.hull, shield: w.playerEnd?.shield }, `seed ${seed} wave ${i}`).toEqual(live[i]));
    }
  });

  it("offline == live: one tick() call, 997 s chunks and 1 s ticks give the same patrol", () => {
    const s0 = dispatched(withCrew(belterXo(combatBase("carrier")), [bucket("flightDeck", "belter", "flight.droneHandling", 40)]), true);
    const rng = () => 0.5;
    const once = tick(1994, s0, rng);
    const chunks = tick(997, tick(997, s0, rng), rng);
    let ones = s0;
    for (let i = 0; i < 1994; i++) ones = tick(1, ones, rng);
    expect(chunks.captains).toEqual(once.captains);
    expect(ones.captains).toEqual(once.captains);
  });
});

describe("Vael and Outer-Colony + Survey Aptitude: faster scans, frozen at dispatch", () => {
  const run = (s: GameState) => {
    const r = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    if (!r.success || !r.expedition) throw new Error(`dispatch refused: ${r.reason}`);
    return r.expedition;
  };

  it("each racial (and the buff) adds to scanSpeedBonus at dispatch", () => {
    const base = withAwayTeam(wiringBase());
    const off = run(base).scanSpeedBonus;
    for (const race of ["vael", "outerColony"] as const) {
      const s = seatOfficer(base, "science", [], { race });
      expect(shipSurveyAptitude(s, s.ships[0])).toBe(CREW_RACES[race].racialBonus.seniorStaff);
      expect(run(s).scanSpeedBonus).toBeCloseTo(off + CREW_RACES[race].racialBonus.seniorStaff, 12);
    }
    const crewed = withCrew(base, [bucket("science", "outerColony", "sci.survey", 40)]);
    expect(run(crewed).scanSpeedBonus).toBeCloseTo(off + 40 * (0.0015 + CREW_RACES.outerColony.racialBonus.complement), 12);
  });

  it("an in-flight run keeps the bonus it froze (reseating changes nothing until the next dispatch)", () => {
    const s = seatOfficer(withAwayTeam(wiringBase()), "science", [], { race: "vael" });
    const exp = run(s);
    const later = { ...s, officers: [], expeditions: [exp] };
    expect(economyTick(later, 1, () => 0.5).expeditions[0].scanSpeedBonus).toBe(exp.scanSpeedBonus);
  });
});

describe("Spacer: the sweeping transit speed", () => {
  it("rides the transit speed key: both mission legs and the sheet's transitSpeedMult rise by the racial", () => {
    expect(CREW_RACES.spacer.racialBonus.statKey).toBe(TRANSIT_SPEED_KEY);
    const base = wiringBase();
    const s = seatOfficer(base, "pilot", [], { race: "spacer" });
    const off = effectiveShipStats(base, base.ships[0]);
    const on = effectiveShipStats(s, s.ships[0]);
    const m = CREW_RACES.spacer.racialBonus.seniorStaff;
    expect(on.transitSpeedMult).toBeCloseTo(off.transitSpeedMult * (1 + m), 12);
    expect(outboundLegSpeed(on)).toBeCloseTo(outboundLegSpeed(off) * (1 + m), 12);
    expect(returnLegSpeed(on)).toBeCloseTo(returnLegSpeed(off) * (1 + m), 12);
  });
});

describe("the crew-key guard sees the commanding captain's racial (WR-6, OC-A43)", () => {
  it("a Stheni captain alone speeds the ship's repairs (Damage Control's key)", () => {
    const s = editCaptain(wiringBase(), { race: "stheni" } as Partial<CaptainState>);
    expect(crewRepairSpeedBonus(s, s.ships[0])).toBe(CREW_RACES.stheni.racialBonus.seniorStaff);
    expect(crewRepairSpeedBonus(wiringBase(), wiringBase().ships[0])).toBe(0);
  });

  it("a Belter or Vael captain alone gives the ship the key", () => {
    for (const [race, read] of [
      ["belter", shipDeckHandling],
      ["vael", shipSurveyAptitude],
    ] as const) {
      const s = editCaptain(wiringBase(), { race } as Partial<CaptainState>);
      expect(read(s, s.ships[0]), race).toBe(CREW_RACES[race].racialBonus.seniorStaff);
    }
  });
});
