// Complement plan CP-4, the rest (user 2026-11-10 "Build it"): the Flight Deck Integrity facet on drone replenishment
// below half hull. Golden hashes captured on the code BEFORE the engine edit. Each fixture is a Dispatch Repeatedly
// Crimson-Reaver Warband patrol held at one point of the patrol curve (ramp 0.2, a real fight the ship wins while its
// hull falls below half), flown 3,000 economyTick seconds; each pins the dispatch record, the display replay every 300 s
// and the state at the end (the fixtures live in cp4FlightDeck.fixture.ts):
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
import type { PatrolMissionState } from "./model";
import { economyTick } from "./tick";
import { replayPatrol } from "./combat/patrolReplay";
import { hash as goldenHash, withoutRunCounts } from "./firstRunsGoldens.fixture";
import { withCp4FlightDeckOff } from "./cp4FlightDeckSwitch.fixture";
import { CP4_FIXTURES, cp4Dispatched, steadyTick, type Cp4Fixture } from "./cp4FlightDeck.fixture";

const hash = (v: unknown): string => goldenHash(withoutRunCounts(v));

const CP4_SECONDS = 3000;
const REPLAY_EVERY = 300;
type Key = keyof typeof CP4_FIXTURES;
const KEYS = Object.keys(CP4_FIXTURES) as Key[];

function cp4Patrol(f: Cp4Fixture): { out: string[]; steady: number; drones: number } {
  let s = cp4Dispatched(f);
  const first = s.captains[0].mission as PatrolMissionState;
  const out = [hash(first)];
  let steady = 0;
  for (let i = 0; i < CP4_SECONDS; i++) {
    steady += steadyTick(s);
    s = economyTick(s, 1, () => 0.5);
    if (i % REPLAY_EVERY === REPLAY_EVERY - 1 && s.captains[0].mission) out.push(hash(replayPatrol(s, s.captains[0])));
  }
  out.push(hash(s));
  return { out, steady, drones: first.playerDrones.length };
}

// Captured on the code BEFORE the engine edit (on top of 717bba3, in the goldens-first commit of this slice). The switch
// proof below reproduces every one of these with the facet switched off.
const BEFORE: Record<Key, string[]> = {
  steady: ["14f14f16", "a19c0f41", "a19c0f41", "a19c0f41", "b61cd662", "5c11119d", "1cb903", "1cb903", "a0843927", "bf9be3c1", "bf9be3c1", "e470166c"],
  neutral: ["bd785300", "4135aabf", "4135aabf", "4135aabf", "169e765a", "2629f373", "dadf1add", "dadf1add", "9898c031", "626f01eb", "626f01eb", "815a16ac"],
  noDeck: ["c2256c50", "e4282f08", "e4282f08", "e4282f08", "42f558ed", "4740999c", "4740999c", "4740999c", "9f51d6ce", "3264d27a", "3264d27a", "63c2eec3"],
  noDrones: ["de1baa88", "d7941f4f", "d7941f4f", "f9fafee2", "f9fafee2", "f9fafee2", "818da0e4", "c217bdb3", "66e26968", "66e26968", "66e26968", "541463a9"],
};

// The pins today. Each move names its reason; an unchanged pin equals BEFORE.
const GOLDEN: Record<Key, string[]> = {
  // MOVES: the cycle freezes the Flight Deck's Integrity beside its Deck Handling (dispatch record: deckHandlingSteady,
  // and each squadron's deckHandlingSteadyPpm), and the drones recovering while the hull is below half bank at
  // Deck Handling x (1 + it), so the replays and the state move.
  steady: ["35c75dc5", "e598fd29", "e598fd29", "e598fd29", "cc1bfcac", "322b6369", "704339bb", "704339bb", "fe3e1d4f", "2dfb7a77", "2dfb7a77", "69ae5ac6"],
  // Unchanged (the controls): Integrity 10 is a facet of 0; with no Deck Handling there is nothing to lift; a destroyer
  // fields no drones.
  neutral: BEFORE.neutral,
  noDeck: BEFORE.noDeck,
  noDrones: BEFORE.noDrones,
};

describe("CP-4 Flight Deck Integrity on replenish: the goldens (captured before the engine edit)", () => {
  for (const key of KEYS) {
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
      for (const key of KEYS) expect(cp4Patrol(CP4_FIXTURES[key]).out, key).toEqual(BEFORE[key]);
    });
  });
});
