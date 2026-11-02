// Complement plan CP-5 (per-hull crew caps; user 2026-10-16 OC-5 "Eir 900, Orion/Aurora 750 (Recommended)" with the
// division leans): the test-only switch golden files use to prove what the per-hull caps moved (the patrolLegsSwitch /
// wr9Switch precedent). TEST-ONLY (imported by *.test.ts files only).
//
// CP-5 moves one thing: a hull's command structure reads its own SHIP_TYPES complementCap / complementDivisionWeights
// (the Eir's 900 berths, the Aurora / Carrier / Battleship division leans). With the switch OFF
// (commandStructure.ts HULL_CREW_CAPS_SWITCH.live false, for one call or one file, restored after) every hull reads the
// spec template again, so a golden computed inside it is the pre-CP-5 game exactly. The templates are cached per
// switch state, so flipping it never serves a template from the other side.

import { afterAll } from "vitest";
import { HULL_CREW_CAPS_SWITCH } from "./commandStructure";

export function withHullCrewCapsOff<T>(run: () => T): T {
  const was = HULL_CREW_CAPS_SWITCH.live;
  HULL_CREW_CAPS_SWITCH.live = false;
  try {
    return run();
  } finally {
    HULL_CREW_CAPS_SWITCH.live = was;
  }
}

// For a golden FILE captured before CP-5 whose pins are about another slice: the whole file runs with the per-hull caps
// off, and its pins keep proving that slice moved nothing else. Called once at the file's top level: off AT ONCE (so
// describe-time computations see it too), restored after its last test.
export function hullCrewCapsOffForThisFile(): void {
  const was = HULL_CREW_CAPS_SWITCH.live;
  HULL_CREW_CAPS_SWITCH.live = false;
  afterAll(() => {
    HULL_CREW_CAPS_SWITCH.live = was;
  });
}
