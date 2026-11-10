// Complement plan CP-4, the rest (user 2026-11-10 "Build it"): the Flight Deck Integrity facet on drone replenishment
// below half hull. Golden hashes captured on the code BEFORE the engine edit. Each fixture is a Dispatch Repeatedly
// Crimson-Reaver Warband patrol held at one point of the patrol curve (ramp 0.2, a real fight the ship wins while its
// hull falls below half), flown 3,000 economyTick seconds; each pins the dispatch record, the display replay every 300 s
// and the state at the end:
//
//   steady   : a carrier with Deck Handling crew (150 Belter crewmen), a Pilot and an XO at Integrity 20. The one
//              fixture the facet acts on: its drones recover between waves while the hull is below half.
//   neutral  : the same carrier with the two officers at Integrity 10 (the facet is 0): a control.
//   noDeck   : Integrity 20 officers of a race with no Deck Handling racial, and crew without the key: a control (the
//              facet multiplies Deck Handling, so with none it has nothing to act on).
//   noDrones : the steady crew and officers on a destroyer (no drone screen): a control.
//
// The engine commit re-pins ONLY what the facet moves (GOLDEN), with its reason beside it, and proves the move with the
// facet switched off (cp4FlightDeckSwitch.fixture.ts): every fixture then reproduces its capture (BEFORE).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type CrewBucket, type CrewRace, type GameState, type PatrolMissionState, type ShipTypeKey } from "./model";
import { dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { foldedPlayerDefense } from "./combat/bridge";
import { SHIP_TYPES } from "./model";
import { equippedFor } from "./equipmentQueries";
import { seatOfficer } from "./wiring/probes";
import { hash as goldenHash, withoutRunCounts } from "./firstRunsGoldens.fixture";
import { withCp4FlightDeckOff } from "./cp4FlightDeckSwitch.fixture";

const hash = (v: unknown): string => goldenHash(withoutRunCounts(v));

const STAT_10 = { strength: 10, integrity: 10, cunning: 10, constitution: 10 };
const STAT_20 = { ...STAT_10, integrity: 20 };

const bucket = (race: CrewRace, buff1Id: string, count: number): CrewBucket => ({
  profession: "flightDeck",
  rarity: "standard",
  rank: 1,
  race,
  buff1Id,
  buff2Id: null,
  count,
});

interface Fixture {
  hull: ShipTypeKey;
  integrity: typeof STAT_10;
  race: CrewRace;
  crew: CrewBucket;
}

export const CP4_FIXTURES: Readonly<Record<string, Fixture>> = {
  steady: { hull: "carrier", integrity: STAT_20, race: "belter", crew: bucket("belter", "flight.droneHandling", 150) },
  neutral: { hull: "carrier", integrity: STAT_10, race: "belter", crew: bucket("belter", "flight.droneHandling", 150) },
  noDeck: { hull: "carrier", integrity: STAT_20, race: "earthBorn", crew: bucket("earthBorn", "flight.transitOut", 150) },
  noDrones: { hull: "destroyer", integrity: STAT_20, race: "belter", crew: bucket("belter", "flight.droneHandling", 150) },
};

export const CP4_SECONDS = 3000;
const REPLAY_EVERY = 300;

// The crewed save, dispatched on a Repeat Warband patrol held at ramp 0.2 of the patrol curve (a relaunch keeps a ramped
// cycle's stamp, so every cycle of the run flies there).
export function cp4Dispatched(f: Fixture): GameState {
  const base = freshState();
  let s: GameState = installMissingCombatBaselines({ ...base, credits: new Decimal(100000), ships: base.ships.map((sh) => ({ ...sh, typeKey: f.hull })) });
  s = seatOfficer(s, "pilot", [], { race: f.race, stats: f.integrity });
  s = seatOfficer(s, "executive", [], { race: f.race, stats: f.integrity });
  s = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { mode: "active", buckets: [{ ...f.crew }] } } : sh)) };
  const r = dispatchCaptainOnPatrol(s, 1, "crimsonReaverWarband", "balanced", true);
  if (!r.success) throw new Error(`patrol refused: ${r.reason}`);
  const m = r.next.captains[0].mission as PatrolMissionState;
  const held: PatrolMissionState = { ...m, difficulty: { version: 1, firstRun: false, ramp: 0.2, tier: 1, completed: 2 } };
  return { ...r.next, captains: r.next.captains.map((c, i) => (i === 0 ? { ...c, mission: held } : c)) };
}

// The between-wave ticks on which a drone recovered while the hull was below half (the facet's trigger), counted on the
// live loop. The hull max is the cycle's folded pool (the same one the engine compares against).
function steadyTicks(before: GameState): number {
  const m = before.captains[0].mission as PatrolMissionState | null;
  if (!m || m.kind !== "patrol" || m.phase === "limpingHome") return 0;
  const recovering = m.playerDrones.some((sq) => sq.drones.some((d) => !d.alive || d.status === "disrupted"));
  if (!recovering) return 0;
  const ship = before.ships.find((sh) => sh.id === "ship-1")!;
  const max = foldedPlayerDefense(SHIP_TYPES[ship.typeKey], equippedFor(before, ship.id), m.officerCombat, m.captainCombat).hullMax;
  return m.playerHull * 2 < max ? 1 : 0;
}

export function cp4Patrol(f: Fixture): { out: string[]; steady: number; drones: number } {
  let s = cp4Dispatched(f);
  const first = s.captains[0].mission as PatrolMissionState;
  const out = [hash(first)];
  let steady = 0;
  for (let i = 0; i < CP4_SECONDS; i++) {
    steady += steadyTicks(s);
    s = economyTick(s, 1, () => 0.5);
    if (i % REPLAY_EVERY === REPLAY_EVERY - 1 && s.captains[0].mission) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  return { out, steady, drones: first.playerDrones.length };
}

// Captured on the code BEFORE the engine edit (on top of 717bba3, in the goldens-first commit of this slice). The switch
// proof below reproduces every one of these with the facet switched off.
const BEFORE: Record<string, string[]> = {
  steady: ["14f14f16", "a19c0f41", "a19c0f41", "a19c0f41", "b61cd662", "5c11119d", "1cb903", "1cb903", "a0843927", "bf9be3c1", "bf9be3c1", "e470166c"],
  neutral: ["bd785300", "4135aabf", "4135aabf", "4135aabf", "169e765a", "2629f373", "dadf1add", "dadf1add", "9898c031", "626f01eb", "626f01eb", "815a16ac"],
  noDeck: ["c2256c50", "e4282f08", "e4282f08", "e4282f08", "42f558ed", "4740999c", "4740999c", "4740999c", "9f51d6ce", "3264d27a", "3264d27a", "63c2eec3"],
  noDrones: ["de1baa88", "d7941f4f", "d7941f4f", "f9fafee2", "f9fafee2", "f9fafee2", "818da0e4", "c217bdb3", "66e26968", "66e26968", "66e26968", "541463a9"],
};

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<string, string[]> = {
  steady: BEFORE.steady,
  neutral: BEFORE.neutral,
  noDeck: BEFORE.noDeck,
  noDrones: BEFORE.noDrones,
};

describe("CP-4 Flight Deck Integrity on replenish: the goldens (captured before the engine edit)", () => {
  for (const key of Object.keys(CP4_FIXTURES)) {
    it(`${key}: a Repeat Warband patrol (dispatch, replays, the state after ${CP4_SECONDS} s)`, () => {
      const r = cp4Patrol(CP4_FIXTURES[key]);
      if (key === "noDrones") expect(r.drones).toBe(0);
      else expect(r.drones).toBeGreaterThan(0);
      // Self-check: the facet's trigger is reached on the carrier fixtures (drones recovering below half hull).
      if (key !== "noDrones") expect(r.steady).toBeGreaterThan(0);
      expect(r.out).toEqual(GOLDEN[key]);
    });
  }
});

describe("CP-4 Flight Deck Integrity on replenish: switched off, every fixture reproduces its capture", () => {
  it("all four fixtures", () => {
    withCp4FlightDeckOff(() => {
      for (const key of Object.keys(CP4_FIXTURES)) expect(cp4Patrol(CP4_FIXTURES[key]).out, key).toEqual(BEFORE[key]);
    });
  });
});
