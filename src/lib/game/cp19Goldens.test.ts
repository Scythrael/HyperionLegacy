// Complement CP-19 GOLDENS (the Personnel Rosters upgrade track): the rows and their pre-slice pins live in
// cp19Goldens.fixture.ts (captured on feat 3a7c544, before the slice).
//
// CP19_CAPTURE = an output path: record every row (live, and with the slice switched off) instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP19_PINS_PRE, cp19Rows } from "./cp19Goldens.fixture";
import { withoutCp19 } from "./cp19Switch.fixture";
import { CP19_ADDED_IDS, cp19ReadBack } from "./cp19Registry.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";

const CAPTURE = import.meta.env.CP19_CAPTURE as string | undefined;

// MOVED by the slice (OC-17), each by design; every other row held:
//   fresh:facilities, fresh:raw : a new game's facility map gains personnelRosters at its pre-granted Level 1.
//   save:fresh                  : the same key in the save bytes and after a load.
//   save:noTrack                : a v71 save from before the slice gains the key on load (the every-load seed), so it
//                                 loads to exactly what a fresh save loads to (save:fresh's second hash).
//   save:v70                    : the v70 -> v71 step seeds it too.
//   board:level6                : (added row) both boards grow to 20 at Level 6, 22 with a Recruiter (before: the level
//                                 meant nothing, 10 and 11).
//   upgrade:*                   : (added row) the first rung is bought (3,000 credits) and finishes at 120 s, mid-span:
//                                 Level 2 in all three cuts, which agree (before: no such facility, nothing bought).
// Held: fresh:stateHash (the shared whole-state view leaves out the pre-granted Level 1, withoutPreGrantedRostersTrack),
// both boards at three windows and with a Recruiter at Level 1 (slot-keyed: today's 10 and 11 candidates exactly), and
// the 1000 s mission in all three cuts. With the slice switched off every row returns to its pin.
const MOVED: Record<string, unknown> = {
  "fresh:facilities": "2fb4b924",
  "fresh:raw": "69cf0524",
  "save:fresh": ["81fc05c8", "d0923dc6"],
  "save:noTrack": "d0923dc6",
  "save:v70": "da69f2f2",
  "board:level6": [20, "1ea8ca7d", 20, "67337399", 22, "f54e64b4", 22, "b837b77e"],
  "upgrade:steps": ["2e44c08e", 2],
  "upgrade:oneCall": ["2e44c08e", 2],
  "upgrade:chunks": ["2e44c08e", 2],
};
const PINS: Record<string, unknown> = { ...CP19_PINS_PRE, ...MOVED };

describe("Complement CP-19 goldens (captured before the Personnel Rosters track)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp19Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify({ live: now, off: withoutCp19(() => cp19Rows()) }, null, 2));
      return;
    }
    expect(Object.keys(CP19_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the slice switched off every row returns to its pre-CP-19 pin", () => {
    expect(withoutCp19(() => cp19Rows())).toEqual(CP19_PINS_PRE);
  }, 600_000);

  it("the registry read-back names exactly the rows CP-19 added, all live", () => {
    const added = WIRING_REGISTRY.filter((e) => CP19_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...CP19_ADDED_IDS].sort());
    expect(added).toHaveLength(12);
    for (const e of added) expect(e.status.kind, e.id).toBe("live");
    expect(cp19ReadBack(WIRING_REGISTRY)).toHaveLength(WIRING_REGISTRY.length - CP19_ADDED_IDS.size);
  });
});
