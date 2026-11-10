// Complement CP-19 GOLDENS (the Personnel Rosters upgrade track): the rows and their pre-slice pins live in
// cp19Goldens.fixture.ts (captured on feat 3a7c544, before the slice).
//
// CP19_CAPTURE = an output path: record every row (live, and with the slice switched off) instead of asserting.

import { describe, expect, it } from "vitest";
// Wiring WR-10 (the away rules stamped at dispatch, a hire's account program) came after every pin here: the whole file
// runs with WR-10 off (wr10Switch.fixture.ts), so its pins keep proving their own slice (wr10Goldens.test.ts pins WR-10's).
import { wr10OffForThisFile } from "./wr10Switch.fixture";
wr10OffForThisFile();
import { writeFileSync } from "node:fs";
import { CP19_PINS_PRE, boards, cp19Rows, withRecruiter } from "./cp19Goldens.fixture";
import { hash } from "./firstRunsGoldens.fixture";
import { SENIOR_STAFF_ROSTER_BASE } from "./model";
import { seniorStaffCandidates } from "./seniorStaff";
import { awayRecruitCandidates } from "./awayTeam";
import { wiringBase } from "./wiring/probes";
import { withoutCp19 } from "./cp19Switch.fixture";
import { CP19_ADDED_IDS, CP19_MOVED_IDS, CP19_RECRUITER_BEFORE, cp19ReadBack } from "./cp19Registry.fixture";
// Wiring WR-10 flipped twelve away rows after every pin here (wr10Registry.fixture.ts): read back innermost.
import { wr10ReadBack } from "./wr10Registry.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";

const CAPTURE = import.meta.env.CP19_CAPTURE as string | undefined;

// MOVED by the slice (OC-17), each by design; every other row held:
//   fresh:facilities, fresh:raw : a new game's facility map gains personnelRosters at its pre-granted Level 1.
//   save:fresh                  : the same key in the save bytes and after a load.
//   save:noTrack                : a v71 save from before the slice gains the key on load (the every-load seed), so it
//                                 loads to exactly what a fresh save loads to (save:fresh's second hash).
//   save:v70                    : the v70 -> v71 step seeds it too.
//   board:level6                : (added row) both boards grow to 20 at Level 6, 21 with a Recruiter (before: the level
//                                 meant nothing, 10 and 11). The fix round (user 2026-11-09 "Flat +1 always") moved the
//                                 Recruiter half from 22 ("f54e64b4", "b837b77e": x1.08 rounded up) to 21; the read-back
//                                 test below proves the old pins were the same slots plus one, and the new pins are the
//                                 first 21 of them (nothing else moved).
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
  "board:level6": [20, "1ea8ca7d", 20, "67337399", 21, "ec940365", 21, "b01a0019"],
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

  // The fix round's trace (user 2026-11-09 "Flat +1 always"): the Recruiter's Level 6 boards moved from 22 to 21. A
  // board of 22 read the old way (stored size 12, no Recruiter: the same slot-keyed candidates) reproduces the old pins,
  // and its first 21 candidates reproduce the new ones: the move is exactly the one slot x1.08 rounded up added.
  it("read-back: the Recruiter's Level 6 boards are the old 22-slot pins less their last slot", () => {
    const level6 = { ...wiringBase(), facilities: { ...wiringBase().facilities, personnelRosters: { level: 6 } } };
    const old22 = { ...level6, seniorStaffRosterSize: SENIOR_STAFF_ROSTER_BASE + 2 };
    const officers = seniorStaffCandidates(old22);
    const recruits = awayRecruitCandidates(old22);
    expect([officers.length, hash(officers), recruits.length, hash(recruits)]).toEqual([22, "f54e64b4", 22, "b837b77e"]);
    expect([hash(officers.slice(0, 21)), hash(recruits.slice(0, 21))]).toEqual(["ec940365", "b01a0019"]);
    expect(boards(withRecruiter(level6))).toEqual([21, "ec940365", 21, "b01a0019"]);
  });

  it("the registry read-back names exactly the rows CP-19 added, all live", () => {
    const added = WIRING_REGISTRY.filter((e) => CP19_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...CP19_ADDED_IDS].sort());
    expect(added).toHaveLength(12);
    for (const e of added) expect(e.status.kind, e.id).toBe("live");
    expect(cp19ReadBack(wr10ReadBack(WIRING_REGISTRY))).toHaveLength(WIRING_REGISTRY.length - CP19_ADDED_IDS.size);
  });

  it("the registry read-back puts the Recruiter's two moved rows back as WR-5c built them, and only those", () => {
    const moved = WIRING_REGISTRY.filter((e) => CP19_MOVED_IDS.has(e.id));
    expect(moved).toHaveLength(2);
    for (const e of moved) expect([e.curve, e.tolerance, e.claim.startsWith("Recruiter: +1 candidate slot")]).toEqual([{ kind: "linearAbsolute" }, undefined, true]);
    const back = cp19ReadBack(WIRING_REGISTRY);
    for (const e of back.filter((x) => CP19_MOVED_IDS.has(x.id))) expect(e).toMatchObject(CP19_RECRUITER_BEFORE);
    const live = new Map(WIRING_REGISTRY.map((e) => [e.id, e]));
    expect(back.filter((e) => !CP19_MOVED_IDS.has(e.id)).every((e) => live.get(e.id) === e)).toBe(true);
  });
});
