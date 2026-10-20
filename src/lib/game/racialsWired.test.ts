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
import { freshState, outboundLegSpeed, returnLegSpeed, type CaptainState, type CrewBucket, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, tick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { applyDeckHandling } from "./combat/bridge";
import { expeditionCandidates, startExpedition } from "./expedition";
import { effectiveShipStats, shipCrewContribution, shipDeckHandling, shipSurveyAptitude } from "./crewOverlay";
import { CREW_STAT_KEYS, TRANSIT_SPEED_KEY } from "./crewBuffs";
import { CREW_RACES } from "./crewRaces";
import { combatBase, editCaptain, seatOfficer, withAwayTeam, wiringBase } from "./wiring/probes";

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

  it("the dispatch freezes the crew's Deck Handling and seeds every squadron at replenish x (1 + it)", () => {
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
    on.playerDrones.forEach((sq, i) => expect(sq.droneReplenishRate).toBe(Math.round(off.playerDrones[i].droneReplenishRate * (1 + dh))));
    // Never drone hit points or damage (D12: replenishment only).
    on.playerDrones.forEach((sq, i) => expect({ ...sq, droneReplenishRate: 0 }).toEqual({ ...off.playerDrones[i], droneReplenishRate: 0 }));
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
    const r = startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
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
