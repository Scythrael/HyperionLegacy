// Complement CP-13 GOLDENS (hull-family module bonuses): the rows and their pre-bonus pins live in
// cp13Goldens.fixture.ts (captured on feat e46d1d3, before the bonus).
//
// CP13_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { writeFileSync } from "node:fs";
import { CP13_PINS_PRE, cp13Rows } from "./cp13Goldens.fixture";
import { withoutCp13 } from "./cp13Switch.fixture";

const CAPTURE = import.meta.env.CP13_CAPTURE as string | undefined;

// MOVED by the hull-family bonus (OC-13, "One catalog, by hull"), each by design; every other row held:
//   sheet:*:kit          : each hull's bridge and quarters lines (General transit and unload, Prospector extraction,
//                          Explorer sensors on the sheet; every family's two signature divisions in the crew map, so the
//                          Tactician map moves too). The same ships with no module hold.
//   mission:*:fresh      : a run dispatched now carries the stamp and plays on the lines (more ore on the Prospector, a
//                          faster General Freighter, a survey's crew rare finds and the quarters' +3%).
//   shortRange:eir:fresh : the Explorer quarters lift the Eir's Science and Medical crew, the bridge its sensors.
//   patrolRepeat:fresh   : the Destroyer's weapon line and the Security / Engineering lift act over 2500 s.
//   expedition:orion:*   : an expedition freezes everything at dispatch, so a run dispatched now carries the sensors, the
//                          division lifts and the bay perk; the inFlight row dispatches before CP-13 and holds.
//   patrol:inFlight      : the run itself plays exactly as before; it ENDS inside the span, and from then on the ship is
//                          home, where its gear repairs on the current rules (the Engineering lift raises the crew's repair
//                          speed): one piece's repair anchor rebases at the new home rate (gearWearEngine.ts
//                          pieceRepairRate `postRun`, the favoredSpec rule). The Repeat runs never end, and hold.
// Held: every other inFlight run (dispatched before CP-13: no stamp, no frozen line), every ship without a module, the
// fresh Dispatch Once patrol (its route ends before a wave can tell the weapon line apart), and the save bytes.
const MOVED: Record<string, unknown> = {
  "sheet:generalFreighter:kit": "319736cc",
  "sheet:prospectorMiner:kit": "a8199aaf",
  "sheet:destroyer:kit": "8f5a00de",
  "sheet:aurora:kit": "62d2cdef",
  "mission:prospectorMiner:ore:fresh": ["a56128bd", "25dafb85"],
  "mission:generalFreighter:ore:fresh": ["a56128bd", "d5001784"],
  "mission:prospectorMiner:survey:fresh": ["eb52323", "87224c29"],
  "shortRange:eir:fresh": ["1b5ee8ce", "9a79a4d2"],
  "patrolRepeat:destroyer:fresh": ["8f383097", "won:2500", "bbf21a5e"],
  "patrol:destroyer:inFlight": ["c478f282", "won:14", "1f045d80"],
  "expedition:orion:fresh": ["5d1b68ef", "6bdf381e", "33616467"],
};
const PINS: Record<string, unknown> = { ...CP13_PINS_PRE, ...MOVED };

describe("Complement CP-13 goldens (captured before the hull-family module bonuses)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp13Rows(withoutCp13);
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP13_PINS_PRE).length).toBeGreaterThan(20);
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the bonus switched off every row returns to its pre-CP-13 pin", () => {
    expect(withoutCp13(() => cp13Rows(withoutCp13))).toEqual(CP13_PINS_PRE);
  }, 600_000);
});
