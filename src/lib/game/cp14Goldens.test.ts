// Complement CP-14 GOLDENS (hull base sensors and Science amplification): the rows and their pre-slice pins live in
// cp14Goldens.fixture.ts (captured on feat 658014c, before the slice).
//
// CP14_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { patrolUseWearOffForThisFile } from "./patrolUseWearSwitch.fixture";
// Gear wear step 5 (patrol use wear) came after every pin here: the file dispatches its patrols unstamped, so its pins
// keep proving their own slice (gearWearStep5Goldens.test.ts pins what step 5 moved on a patrol).
patrolUseWearOffForThisFile();
import { writeFileSync } from "node:fs";
import { CP14_PINS_PRE, cp14Rows } from "./cp14Goldens.fixture";
import { withoutCp14 } from "./cp14Switch.fixture";

const CAPTURE = import.meta.env.CP14_CAPTURE as string | undefined;

// MOVED by the slice (OC-16 "Explorers lead", OC-20 "Proposed numbers", OC-21 "Multiply"), each by design; every other
// row held:
//   sheet:<explorer or warship>:* : the hull's base sensors join the Sensor Suite's points (Aurora 35, Orion 25, Eir 15,
//                          each warship 10), so a bare hull reads its base and an array adds its 20 on top.
//   sheet:*:science        : the Science division (50 heads: x (1 + 0.08 ln 3) = x 1.0879) and a Lieutenant Science officer
//                          (x (1 + 0.12 x 1.2) = x 1.144) multiply the flat sum, on every hull with sensors (the freighter and
//                          the Prospector too, on the array alone). A hull with no sensors and no array stays at 0.
//   sheet:aurora:cadet / commander : the seat lift by rank (Cadet x 1.102, Commander x 1.21).
//   sheet:*:focused        : Focused Command lifts the Science officer by 30% on the Aurora and the Prospector (Science is a
//                          role seat on explorer and prospector hulls), and the CP-13 Explorer bridge line (+10%) now also
//                          multiplies the base and the Science lift on the Aurora. On the Destroyer it lifts nothing more.
//   mission:*:survey:*     : a survey dispatched now carries the hullSensors stamp and its yield reads the new sensors; the
//                          inFlight rows (dispatched with the slice off: no stamp) HOLD at their pre-CP-14 pins.
//   shortRange:eir:fresh   : the Eir's run reads its base sensors and the Science lift (the scan job's time and yield).
//   expedition:*:fresh / bare : an expedition freezes its sensors at dispatch, so a run dispatched now carries the new
//                          sensor power (its voyage holds); the inFlight row dispatches before CP-14 and holds.
// Held: every inFlight run, the ore run (no sensor reader), the freighter's survey with no array (0 stays 0), the patrol
// (no patrol reads sensors), the freighter and Prospector sheets without the Science people, and the save bytes.
const MOVED: Record<string, unknown> = {
  "sheet:aurora:bare": [35,"34b77d47"],
  "sheet:aurora:array": [55,"11b9d6e1"],
  "sheet:aurora:science": [68.449975,"815049d"],
  "sheet:orion:bare": [25,"25697d75"],
  "sheet:orion:array": [45,"b04cf913"],
  "sheet:orion:science": [56.004525,"137d59c7"],
  "sheet:eir:bare": [15,"69a7d88e"],
  "sheet:eir:array": [35,"8f17bbc0"],
  "sheet:eir:science": [43.559075,"5e8a5183"],
  "sheet:destroyer:bare": [10,"df19746e"],
  "sheet:destroyer:array": [30,"1eada78"],
  "sheet:destroyer:science": [37.33635,"4ae50aa3"],
  "sheet:battleship:bare": [10,"6706bda2"],
  "sheet:battleship:array": [30,"89d823ac"],
  "sheet:battleship:science": [37.33635,"1555672f"],
  "sheet:carrier:bare": [10,"75bc5f54"],
  "sheet:carrier:array": [30,"529b476a"],
  "sheet:carrier:science": [37.33635,"cf94a0a5"],
  "sheet:generalFreighter:science": [24.8909,"107840ba"],
  "sheet:prospectorMiner:science": [24.8909,"86137714"],
  "sheet:aurora:scienceNoArray": [43.559075,"ae3940e9"],
  "sheet:aurora:cadet": [65.936951,"323cefa7"],
  "sheet:aurora:commander": [72.399012,"7940a3d8"],
  "sheet:aurora:focused": [78.138279,"d5ac3cc4"],
  "sheet:prospectorMiner:focused": [25.830836,"ffb3bc4c"],
  "sheet:destroyer:focused": [37.33635,"4ae50aa3"],
  "mission:orion:survey:fresh": ["eb52323","20c4c786"],
  "mission:prospectorMiner:survey:fresh": ["eb52323","b0b5e133"],
  "shortRange:eir:fresh": ["1b5ee8ce","735e57e4"],
  "expedition:orion:fresh": ["9b7820ac","53ef0134","9d6b2bd6"],
  "expedition:aurora:bare": ["739f92bf","b630c64d","120384b1"],
};
// GEAR WEAR step 5 review fix C1 (exact repair settling, 2026-11-09): the Eir's Science and Medical crew lift raises its gear repair rate off the free 2, 40 and 80 a minute, so their pieces'
// repair anchors are now encoded exactly from integers (the rate quantized to a thousandth of a per-mille a minute)
// where the old float arithmetic drifted; only the state hashes move (with the old settle every pin here holds, checked
// at the fix). C1_MOVED overlays the current pins, C1_MOVED_PRE the pre-slice pins.
const C1_MOVED: Record<string, unknown> = {
  "shortRange:eir:fresh": ["1b5ee8ce", "4e04de09"],
  "shortRange:eir:inFlight": ["1b5ee8ce", "f48d7321"],
};
const C1_MOVED_PRE: Record<string, unknown> = {
  "shortRange:eir:fresh": ["1b5ee8ce", "f48d7321"],
  "shortRange:eir:inFlight": ["1b5ee8ce", "f48d7321"],
};
const PINS: Record<string, unknown> = { ...CP14_PINS_PRE, ...MOVED, ...C1_MOVED };

describe("Complement CP-14 goldens (captured before hull base sensors and Science amplification)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp14Rows(withoutCp14);
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP14_PINS_PRE).length).toBeGreaterThan(30);
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the slice switched off every row returns to its pre-CP-14 pin", () => {
    expect(withoutCp14(() => cp14Rows(withoutCp14))).toEqual({ ...CP14_PINS_PRE, ...C1_MOVED_PRE });
  }, 600_000);
});
