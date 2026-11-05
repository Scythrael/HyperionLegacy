// WR-7 follow-up OC-D5 favorsSpec GOLDENS: the rows and their pre-bonus pins live in favorsSpecGoldens.fixture.ts
// (captured on feat 502a0c8, before the favored bonus). Use wear stays off: the pins are about the favored lines.
//
// FAVORS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { hullCrewCapsOffForThisFile } from "./hullCrewCapsSwitch.fixture";
// Complement plan CP-5 (per-hull crew caps): every pin here predates CP-5 and is about another slice, so the file runs
// with the per-hull caps off (hullCrewCapsSwitch.fixture.ts); cp5Goldens.test.ts pins what CP-5 moved.
hullCrewCapsOffForThisFile();
import { writeFileSync } from "node:fs";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { FAVORS_PINS_PRE, favorsRows } from "./favorsSpecGoldens.fixture";
import { withFavoredSpecOff } from "./favoredSpecSwitch.fixture";
import { patrolLegsOffForThisFile } from "./patrolLegsSwitch.fixture";
import { wr11OffForThisFile } from "./wr11Switch.fixture";
import { wr9OffForThisFile } from "./wr9Switch.fixture";

// Wiring WR-9: this file's pins are about other slices and were captured before WR-9; it runs with WR-9 off (the
// WR-9 moves are pinned and proven in wr9Goldens.test.ts), so every pin here keeps proving its own slice exactly.
wr9OffForThisFile();

// WR-7 follow-up OC-D8 (patrol legs scale with transit speed): every pin here predates the legs and is about OC-D5 favorsSpec;
// with the legs off each one returns (checked when the legs were wired), so the file runs with them off and keeps
// proving its own slice. patrolLegsGoldens.test.ts pins the legs on every patrol and every combat hull.
patrolLegsOffForThisFile();
// Wiring WR-11 came after every pin here: the whole file runs with WR-11 off (wr11Switch.fixture.ts), so its pins keep
// proving their own slice moved nothing else (WR-11's own moves are pinned in wr11Goldens.test.ts).
wr11OffForThisFile();

gearWearOffInThisFile();

const CAPTURE = import.meta.env.FAVORS_CAPTURE as string | undefined;

// MOVED by the favored bonus (user 2026-10-29 "+10% on its ship type"), each by design; every other row held:
//   mission:prospectorMiner:fresh : the Prospector Hold and Yield Rig count +10% on a Prospector (more hold and yield),
//                                   so the run hauls more. The General Freighter (unfavored) and the same run dispatched
//                                   before the bonus (inFlight, no stamp) hold.
//   expedition:orion:pathfinder   : the Pathfinder Suite counts +10% on an Orion (an Explorer hull): its sensors, scan
//                                   speed and hazard resist freeze higher at dispatch. The voyage holds (the suite carries
//                                   no speed line); the hold and the Damage Control Suite (unfavored there) hold.
// Held: the short-range runs (the Eir's job reads its Sensors only to pass the sheet), every patrol (no wave left the hull
// short enough for the suite's patch-up to round differently), and every inFlight row (a run without the stamp reads its
// pieces as stored).
const MOVED: Record<string, unknown> = {
  "mission:prospectorMiner:fresh": ["21b85cb7", "68d5f404"],
  "expedition:orion:pathfinder": ["9b7820ac", "b75a975e", "a01bef98"],
};
const PINS: Record<string, unknown> = { ...FAVORS_PINS_PRE, ...MOVED };

describe("OC-D5 favorsSpec goldens", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = favorsRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the favored bonus switched off every row returns to its pre-bonus pin", () => {
    expect(withFavoredSpecOff(() => favorsRows())).toEqual(FAVORS_PINS_PRE);
  }, 600_000);
});
