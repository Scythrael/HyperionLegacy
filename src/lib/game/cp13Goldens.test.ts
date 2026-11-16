// Complement CP-13 GOLDENS (hull-family module bonuses): the rows and their pre-bonus pins live in
// cp13Goldens.fixture.ts (captured on feat e46d1d3, before the bonus).
//
// CP13_CAPTURE = an output path: record every row instead of asserting.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
// FR-C lane 1 M5 / M6 (Never discard: deliveries land in full, a load trims nothing) came after every pin here: the file
// runs with it off (neverDiscardSwitch.fixture.ts), so its pins keep proving their own slice; neverDiscard.test.ts pins
// the move.
import { neverDiscardOffForThisFile } from "./neverDiscardSwitch.fixture";
neverDiscardOffForThisFile();
// Relics v2 source planets (user 2026-11-13 "First + count") came after these pins: each blank now also carries its
// planet's name (display only). The file runs with the stamp off, so every pin reproduces as captured (relicPlanet.fixture.ts).
import { planetStampOffForThisFile } from "./relicPlanet.fixture";
planetStampOffForThisFile();
// WR-8b (enemy torpedoes) came after every pin here: the file runs with it off (enemyTorpedoSwitch.fixture.ts), so its
// pins keep proving their own slice (enemyTorpedoGoldens.test.ts pins what WR-8b moved, enemyTorpedoes.test.ts proves it).
import { enemyTorpedoesOffForThisFile } from "./enemyTorpedoSwitch.fixture";
enemyTorpedoesOffForThisFile();
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
cp19OffForThisFile();
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
import { cp14OffForThisFile } from "./cp14Switch.fixture";
// Complement CP-14 (hull base sensors and Science amplification) came after every pin here: the file runs with the
// slice off, so its pins keep proving their own slice (cp14Goldens.test.ts pins what CP-14 moved).
cp14OffForThisFile();
import { writeFileSync } from "node:fs";
import { CP13_PINS_PRE, cp13Rows } from "./cp13Goldens.fixture";
import { withoutCp13 } from "./cp13Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
import { fixRoundESwitchesOffForThisFile } from "./fixRoundESwitch.fixture";

// Fix round FR-E (0.14.0): Resume when safe (lane 4 I1, PATROL_RESUME_WHEN_SAFE_SWITCH: a Repeat repair pause ends once
// the next route is safe, not at full) moves the Repeat rows' repair pauses; and the pause's docked pricing (lane 4 M6,
// PAUSE_JOB_LIKE_DOCKED_SWITCH: a repair pause records the docked job's length for its Overtime) moves the same pauses'
// records. The pins here predate the round and are about another slice, so the file runs with those fixes off
// (fixRoundESwitch.fixture.ts); every other fix of the round runs here. The round's own pins: patrolFixRoundE.test.ts.
fixRoundESwitchesOffForThisFile("resumeWhenSafe", "pauseJobLikeDocked");
homeworldReserveOffForThisFile();

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
// GEAR WEAR step 5 review fix C1 (exact repair settling, 2026-11-09): the hull-family crew lift and the officers raise these ships' gear repair rates off the free 2, 40 and 80 a minute, so their pieces'
// repair anchors are now encoded exactly from integers (the rate quantized to a thousandth of a per-mille a minute)
// where the old float arithmetic drifted; only the state hashes move (with the old settle every pin here holds, checked
// at the fix). C1_MOVED overlays the current pins, C1_MOVED_PRE the pre-slice pins.
const C1_MOVED: Record<string, unknown> = {
  "mission:prospectorMiner:ore:fresh": ["a56128bd", "552b05a4"],
  "mission:generalFreighter:ore:fresh": ["a56128bd", "4bfb5de"],
  "mission:prospectorMiner:survey:fresh": ["eb52323", "d5c13d6d"],
  "patrol:destroyer:fresh": ["c478f282", "won:14", "37b07ac2"],
  "patrolRepeat:destroyer:fresh": ["8f383097", "won:2500", "9402a616"],
  "mission:prospectorMiner:ore:inFlight": ["a56128bd", "5543a630"],
  "mission:generalFreighter:ore:inFlight": ["a56128bd", "b5af8610"],
  "patrolRepeat:destroyer:inFlight": ["8f383097", "won:2500", "5b8da85f"],
  "mission:prospectorMiner:ore:none": ["a56128bd", "db32b9f1"],
};
const C1_MOVED_PRE: Record<string, unknown> = {
  "mission:prospectorMiner:ore:fresh": ["a56128bd", "5543a630"],
  "mission:generalFreighter:ore:fresh": ["a56128bd", "b5af8610"],
  "patrolRepeat:destroyer:fresh": ["8f383097", "won:2500", "5b8da85f"],
  "mission:prospectorMiner:ore:inFlight": ["a56128bd", "5543a630"],
  "mission:generalFreighter:ore:inFlight": ["a56128bd", "b5af8610"],
  "patrolRepeat:destroyer:inFlight": ["8f383097", "won:2500", "5b8da85f"],
  "mission:prospectorMiner:ore:none": ["a56128bd", "db32b9f1"],
};
const PINS: Record<string, unknown> = { ...CP13_PINS_PRE, ...MOVED, ...C1_MOVED };

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
    expect(withoutCp13(() => cp13Rows(withoutCp13))).toEqual({ ...CP13_PINS_PRE, ...C1_MOVED_PRE });
  }, 600_000);
});
