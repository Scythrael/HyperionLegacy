// Lane 4 M8 (docs/qa/2026-11-13-fable-sweep-ledger.md; FR-E traced it to M4's cause): a carrier's complement buckets
// differed by chunking on a Repeat patrol. Two once-per-call steps sat at the END of an economyTick call:
//   - a patrol run that ended inside the call (an "outmatched" stop, a defeat's limp home landing) had its passive crew
//     fill (crewOverlay.ts resolveCrew), its Shipyard hull repair auto-start (processShipRepairs) and its crew hours
//     settled at the call's end. economyTick now splits the call at the whole tick the ship comes home (tick.ts
//     PATROL_HOME_SPLIT_SWITCH);
//   - a call spanning two or more transport windows delivered them all, then filled once (the filler goes top rank down
//     over the joined pool, so a ship with open berths kept its crew in another order). It now fills window by window
//     (crewOverlay.ts CREW_WINDOW_FILL_SWITCH).
// One call, 997 s chunks and 1 s steps now leave the same state, byte for byte. Production steps one tick per call (live
// and the offline catch-up alike), where neither acts, so nothing a player sees changes; the last block proves it on
// tick() itself.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type GameState } from "./model";
import { dispatchCaptainOnPatrol, economyTick, tick } from "./tick";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withStopDoomedOff } from "./fixRoundESwitch.fixture";
import { withCrewWindowFillOff, withLane4M8Off, withPatrolHomeSplitOff } from "./patrolHomeSplitSwitch.fixture";

const RNG = () => 0.5;

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}
function chunked(s: GameState, total: number, step: number): GameState {
  let out = s;
  for (let left = total; left > 0; left -= step) out = economyTick(out, Math.min(step, left), RNG);
  return out;
}
const veteran = (hull: "destroyer" | "carrier" | "battleship"): GameState =>
  asPatrolVeteran({ ...onHull(hull), nextPatrolSeed: 1, credits: new Decimal(10_000_000) });
const repeatSweep = (hull: "destroyer" | "carrier" | "battleship"): GameState => {
  const r = dispatchCaptainOnPatrol(veteran(hull), 1, "crimsonReaverSweep", "balanced", true);
  expect(r.success, r.reason).toBe(true);
  return r.next;
};
const json = (s: GameState): string => JSON.stringify(s);
const buckets = (s: GameState): string => JSON.stringify(s.ships.map((sh) => sh.complement));

describe("M8: a carrier's Repeat patrol, one call == 997 s chunks == 1 s steps", () => {
  const T = 6000;
  it("the run ends mid-call ('outmatched') and transports land after it: the whole state is byte-identical", { timeout: 300_000 }, () => {
    const start = repeatSweep("carrier");
    const steps = stepped(start, T);
    // The run really ended inside the span, before transport windows still to come.
    expect(steps.captains[0].mission).toBeNull();
    expect(steps.completionLog?.at(-1)?.patrolEndReason).toBe("outmatched");
    expect(json(economyTick(start, T, RNG))).toBe(json(steps));
    expect(json(chunked(start, T, 997))).toBe(json(steps));
  });
  it("with the fix off, one call keeps other complement buckets (the bug): here the window-by-window fill is the half that matters", { timeout: 300_000 }, () => {
    // The ship comes home in tick 1784 with nothing to take yet; transports land at 1800, 3600 and 5400 s, and one call
    // filled from all three at once.
    const start = repeatSweep("carrier");
    const steps = stepped(start, T);
    expect(buckets(withLane4M8Off(() => economyTick(start, T, RNG)))).not.toBe(buckets(steps));
    expect(buckets(withCrewWindowFillOff(() => economyTick(start, T, RNG)))).not.toBe(buckets(steps));
  });
  for (const hull of ["destroyer", "battleship"] as const) {
    it(`${hull}: the same holds`, { timeout: 300_000 }, () => {
      const start = repeatSweep(hull);
      const steps = stepped(start, T);
      expect(json(economyTick(start, T, RNG))).toBe(json(steps));
      expect(json(chunked(start, T, 997))).toBe(json(steps));
    });
  }
});

describe("M4: a patrol that ends in defeat mid-call (the stop rule off, to reach a defeat)", () => {
  const T = 8000;
  const lost = (): GameState => withStopDoomedOff(() => repeatSweep("carrier"));
  it("the Shipyard repair and the crew fill start where 1 s steps start them: the whole state is byte-identical", { timeout: 300_000 }, () => {
    const [one, chunks, steps] = withStopDoomedOff(() => [economyTick(lost(), T, RNG), chunked(lost(), T, 997), stepped(lost(), T)]);
    expect(steps.captains[0].lastStopReason).toBe("defeat");
    expect(json(one)).toBe(json(steps));
    expect(json(chunks)).toBe(json(steps));
  });
  it("with either half of the fix off, one call differs from 1 s steps (the old behavior)", { timeout: 300_000 }, () => {
    // The wreck lands in tick 3079, between the transports of 1800 and 3600 s: the split and the window fill both act.
    const steps = withStopDoomedOff(() => stepped(lost(), T));
    for (const off of [withLane4M8Off, withPatrolHomeSplitOff, withCrewWindowFillOff]) {
      expect(json(withStopDoomedOff(() => off(() => economyTick(lost(), T, RNG))))).not.toBe(json(steps));
    }
  });
});

describe("production (tick(): one economyTick per whole tick) is unchanged by the fix", () => {
  it("a carrier Repeat run and a defeat: tick() with the fix on == with it off, byte for byte", { timeout: 300_000 }, () => {
    const repeat = repeatSweep("carrier");
    expect(json(tick(6000, repeat, RNG))).toBe(json(withLane4M8Off(() => tick(6000, repeat, RNG))));
    const lost = withStopDoomedOff(() => repeatSweep("carrier"));
    const on = withStopDoomedOff(() => tick(8000, lost, RNG));
    const off = withStopDoomedOff(() => withLane4M8Off(() => tick(8000, lost, RNG)));
    expect(on.captains[0].lastStopReason).toBe("defeat");
    expect(json(on)).toBe(json(off));
  });
});
