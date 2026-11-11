// Complement plan CP-4's rest (user 2026-11-10 "Build it"): the test-only switch golden files use to prove what the
// Flight Deck Integrity facet on drone replenishment moved (the WR11_SWITCH / withWr11Off precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// The facet makes one stamp: a patrol cycle freezes the Flight Deck's Integrity lift (the facet x the Flight Deck's own
// Deck Handling) beside its Deck Handling (PatrolMissionState.deckHandlingSteady) and seeds its squadrons with the rate
// they replenish at below half hull (DroneSquadron.deckHandlingSteadyPpm). With the switch OFF (model.ts
// CP4_FLIGHT_DECK_INTEGRITY_SWITCH.live false, for one call, restored after) neither is written, so every patrol computed
// inside it is the game before the facet exactly.

import { CP4_FLIGHT_DECK_INTEGRITY_SWITCH } from "./model";

export function withCp4FlightDeckOff<T>(run: () => T): T {
  const was = CP4_FLIGHT_DECK_INTEGRITY_SWITCH.live;
  CP4_FLIGHT_DECK_INTEGRITY_SWITCH.live = false;
  try {
    return run();
  } finally {
    CP4_FLIGHT_DECK_INTEGRITY_SWITCH.live = was;
  }
}
