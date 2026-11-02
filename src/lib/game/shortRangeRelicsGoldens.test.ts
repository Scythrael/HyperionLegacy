// G1-5 (Short-Range Missions: relic drops, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-5): GOLDENS,
// captured on feat/crew-0.14.0 @ 3306bda BEFORE the engine change. Whole-state hashes of short-range runs on the board
// (Tier I and Tier II slots on Repeat, a recalled run with its completion log entry), at several points of a long run.
//
// What they hold after G1-5:
// - `inflight:*`: a run dispatched before G1-5 (no relic stamp on its mission) plays BYTE-IDENTICALLY: the whole state,
//   unstripped, equals the pin (asPreRelicDispatch takes the stamp off a fresh dispatch, a no-op before G1-5).
// - every other pin: a stamped run equals the pin once its relic finds are taken out (withoutShortRangeRelics: the
//   stamp, the run's relic count, the vault tokens it found and the completion entry's relic count), so the drops
//   moved NOTHING else (credits, materials, XP, counters, the board cursor, the log): the relic roll is additive, on
//   its own keyed stream. Both helpers are no-ops on a state from before G1-5.

import { describe, expect, it } from "vitest";
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();
gearWearOffInThisFile();
import { type GameState } from "./model";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { economyTick, recallCaptain } from "./tick";
import { resolveCrew } from "./crewOverlay";
import { hash } from "./firstRunsGoldens.fixture";
import { asPreRelicDispatch, withoutShortRangeRelics } from "./shortRangeRelics.fixture";
import { WIRING_CAPTAIN_ID, editShip, installPiece, wiringBase } from "./wiring/probes";

const RNG = (): number => 0.5;
const NOW = 1_700_000_000_000;

// A crewed Eir (48 h of hires) with a sensor array and a 30 berth Guest Wing: meets the Tier I and Tier II sheets.
// Mission Control at level 2 (slot 2 is the Tier II slot).
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 48 * 3600 });
  const sensed = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  const s = installPiece(sensed, { slotType: "quarters", moduleVariant: "quartersGuestWing", implicitStats: { colonistCapacity: 30 } });
  return { ...s, facilities: { ...s.facilities, missionControl: { ...s.facilities.missionControl, level: 2 } } };
}

function dispatched(slotId: number, repeat = true): GameState {
  const r = dispatchCaptainOnShortRange(qualified(), WIRING_CAPTAIN_ID, slotId, repeat);
  expect(r.success, String(r.reason)).toBe(true);
  return r.next;
}

// Advance `hours` in one-hour economyTick calls (a lone captain: one call equals 1 s steps, shortRangeCycle.test.ts).
function hoursOn(s: GameState, hours: number): GameState {
  let out = s;
  for (let h = 0; h < hours; h++) out = economyTick(out, 3600, RNG, NOW + h * 3_600_000);
  return out;
}

const PINS: Record<string, string> = {
  "tierI:1h": "19b6b6a2",
  "tierI:12h": "3d720091",
  "tierI:48h": "2487c82d",
  "tierII:1h": "36b482fd",
  "tierII:12h": "d37894e8",
  "tierII:48h": "f383b047",
  "recall:tierI": "c1c851bc",
  "recall:tierII": "1751ec1a",
};

function pinned(key: string, s: GameState): void {
  expect.soft(hash(s), key).toBe(PINS[key]);
}

// The cycles a state's lifetime tally holds (so the pins are long runs, not a stalled one).
function delivered(s: GameState): number {
  return Object.entries(s.lifetimeStats.missionsCompleted)
    .filter(([k]) => k.startsWith("shortRange:"))
    .reduce((n, [, v]) => n + Number(v), 0);
}

describe("G1-5 goldens: short-range runs before relic drops", () => {
  for (const [label, slotId] of [["tierI", 0], ["tierII", 2]] as const) {
    it(`${label}: a Repeat run at 1, 12 and 48 hours; a stamped run equals it without its relic finds, an in-flight one unstripped`, () => {
      const stamped = dispatched(slotId);
      const inflight = asPreRelicDispatch(stamped);
      let a = stamped;
      let b = inflight;
      let at = 0;
      for (const h of [1, 12, 48]) {
        a = hoursOn(a, h - at);
        b = hoursOn(b, h - at);
        at = h;
        pinned(`${label}:${h}h`, withoutShortRangeRelics(a));
        pinned(`${label}:${h}h`, b);
      }
      expect(delivered(a)).toBeGreaterThan(400);
    });
  }

  it("a recalled run: its completion log entry, the run's state after it ends", () => {
    for (const [label, slotId] of [["tierI", 0], ["tierII", 2]] as const) {
      const recall = (s: GameState): GameState => {
        const out = recallCaptain(hoursOn(s, 24), WIRING_CAPTAIN_ID, NOW);
        expect(out.success).toBe(true);
        return hoursOn(out.next, 2);
      };
      const stamped = recall(dispatched(slotId));
      expect(stamped.captains[0].mission).toBeNull();
      pinned(`recall:${label}`, withoutShortRangeRelics(stamped));
      pinned(`recall:${label}`, recall(asPreRelicDispatch(dispatched(slotId))));
    }
  });
});
