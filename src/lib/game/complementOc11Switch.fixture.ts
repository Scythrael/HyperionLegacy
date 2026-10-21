// OC-11 (CP-8, docs/plans/2026-10-14-complement-and-acquisition-plan.md): the TEST switch that proves the auto-crew
// pause ("Pause while out", user 2026-10-16) is the ONLY thing OC-11 moved in a golden. withOc11Off(fn) makes the one
// crew-lock predicate (crewLock.ts shipCrewLocked) answer "not locked" to every caller for the duration of fn, which is
// exactly the pre-OC-11 auto-crew; each moved golden then reproduces its capture from before the OC-11 edit. A lock
// reader other than the auto-crew that the switch reached would show up as a mismatch there. Outside withOc11Off the
// real predicate answers.
//
// A test file opts in with (the factory is hoisted, so it imports this module itself):
//   vi.mock("./crewLock", async (io) => (await import("./complementOc11Switch.fixture")).oc11CrewLockMock(io));
// Test-only: no engine module imports this file.

import type * as CrewLock from "./crewLock";
import type { GameState } from "./model";

const OC11_SWITCH = { off: false };

export async function oc11CrewLockMock(importOriginal: () => Promise<unknown>): Promise<typeof CrewLock> {
  const real = (await importOriginal()) as typeof CrewLock;
  return {
    ...real,
    shipCrewLocked: (s: GameState, shipId: string) => (OC11_SWITCH.off ? false : real.shipCrewLocked(s, shipId)),
  };
}

export function withOc11Off<T>(fn: () => T): T {
  const was = OC11_SWITCH.off;
  OC11_SWITCH.off = true;
  try {
    return fn();
  } finally {
    OC11_SWITCH.off = was;
  }
}
