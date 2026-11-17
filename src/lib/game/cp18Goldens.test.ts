// Complement CP-18 GOLDENS (the soft captain level cap): the rows and their pre-slice pins live in cp18Goldens.fixture.ts
// (captured on feat 8d3809b, before the slice).
//
// CP18_CAPTURE = an output path: record every row instead of asserting.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP18_PINS_PRE, cp18Rows } from "./cp18Goldens.fixture";
import { withoutCp18 } from "./cp18Switch.fixture";
import { CP18_ADDED_IDS, cp18ReadBack } from "./cp18Registry.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";
// Complement CP-19: this file's pins predate the Personnel Rosters track (a new game's facility map gains its
// pre-granted Level 1), so it runs with the slice off; cp19Goldens.test.ts pins the slice itself.
import { cp19OffForThisFile } from "./cp19Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();
cp19OffForThisFile();

const CAPTURE = import.meta.env.CP18_CAPTURE as string | undefined;

// MOVED by the slice (OC-23), each by design; every other row held:
//   curve              : the costs past level 30 (at or below it they hold).
//   mission:pastCap:*  : level 35 holding 10450 XP no longer reaches level 36 on 1000 XP (it needs 15428 now): same
//                        level, 11450 XP. Nothing is taken away.
//   mission:milestone:*: level 39 holding 11650 XP no longer reaches level 40, so no notable yet.
//   mission:bigAward:* : the same 301875 XP buys fewer levels past the threshold; the three cuts still agree.
//   mission:realRate:* : (fix round) level 39 holding 22338 XP at the real x1.05 of one retirement: the 1050 XP now lands
//                        exactly on the new 23388 price at the last second (level 40, 0 XP left) instead of crossing the
//                        old 11700 on the first; all three cuts agree on both sides.
//   patrol:pastCap     : level 39 holding 11699 XP: the first won wave's XP no longer reaches level 40.
//   shortRange:pastCap : the same, on the delivered cycle's XP.
//   offline:pastCap    : the While You Were Away rows follow: the gross XP holds, the levels gained drop.
// Held: mission:belowCap (level 29 to 30), mission:atCap (the threshold level's own cost, then 950 XP into level 31),
// save:pastCap (no format change, no version bump, nothing rewritten on load) and retire:pastCap (a retirement reads no
// curve). With the slice switched off every row returns to its pin.
const MOVED: Record<string, unknown> = {
  "curve": [300, 600, 8700, 9000, 10044, 15428, 25907, 69914, 6558192, 28852914125],
  "mission:pastCap:steps": ["86daa2a4", "5c293fc1"],
  "mission:pastCap:oneCall": ["86daa2a4", "5c293fc1"],
  "mission:pastCap:chunks": ["86daa2a4", "5c293fc1"],
  "mission:milestone:steps": ["f32e9441", "9cbb219a"],
  "mission:milestone:oneCall": ["f32e9441", "9cbb219a"],
  "mission:milestone:chunks": ["f32e9441", "9cbb219a"],
  "mission:bigAward:steps": ["3965862f", "433fe3c8"],
  "mission:bigAward:oneCall": ["3965862f", "433fe3c8"],
  "mission:bigAward:chunks": ["3965862f", "433fe3c8"],
  "mission:realRate:steps": ["9e05e586", "fc11c6b8"],
  "mission:realRate:oneCall": ["9e05e586", "fc11c6b8"],
  "mission:realRate:chunks": ["9e05e586", "fc11c6b8"],
  "patrol:pastCap": ["9723514a", "aea99086"],
  "shortRange:pastCap": ["c9a3925f", "5ca32a69"],
  "offline:pastCap": ["b8ca91a1", "283ec22e"],
};
// GEAR WEAR step 5 review fix C1 (exact repair settling, 2026-11-09; built on 8d3809b, before this slice, so traced here at
// its merge): the Eir's Science and Medical crew lift raises its gear repair rate off the free 2, 40 and 80 a minute, so
// its pieces' repair anchors are now encoded exactly from integers (the rate quantized to a thousandth of a per-mille a
// minute) where the old float arithmetic drifted (the cp14Goldens.test.ts shortRange:eir rows, the same run). Only the
// state hash moves; the captain hash holds. With the old settle every pin here holds, both live and with the slice
// switched off (checked at the trace, 2026-11-10); the gear repair job record (gearRepairJobSwitch.fixture.ts) moves
// nothing here. C1_MOVED overlays the current pins, C1_MOVED_PRE the pre-slice pins.
const C1_MOVED: Record<string, unknown> = {
  "shortRange:pastCap": ["821f329c", "5ca32a69"],
};
const C1_MOVED_PRE: Record<string, unknown> = {
  "shortRange:pastCap": ["f950eff1", "e60a6c68"],
};
// SAVE v72 (0.14.0 Standard-Issue crew modules): the save bytes carry the new SAVE_VERSION, so only the save rows
// move (with SAVE_VERSION held at 71 every one returns to its pin, checked). V72_MOVED overlays the current pins,
// V72_MOVED_PRE the pre-slice pins.
const V72_MOVED: Record<string, unknown> = { "save:pastCap": ["c8965217", "b93c3548"] };
const V72_MOVED_PRE: Record<string, unknown> = { "save:pastCap": ["c8965217", "b93c3548"] };
const PINS: Record<string, unknown> = { ...CP18_PINS_PRE, ...MOVED, ...C1_MOVED, ...V72_MOVED };

describe("Complement CP-18 goldens (captured before the soft level cap)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp18Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP18_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the slice switched off every row returns to its pre-CP-18 pin", () => {
    expect(withoutCp18(() => cp18Rows())).toEqual({ ...CP18_PINS_PRE, ...C1_MOVED_PRE, ...V72_MOVED_PRE });
  }, 600_000);

  it("the registry read-back names exactly the row CP-18 added, live", () => {
    const added = WIRING_REGISTRY.filter((e) => CP18_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...CP18_ADDED_IDS].sort());
    for (const e of added) expect(e.status.kind, e.id).toBe("live");
    expect(cp18ReadBack(WIRING_REGISTRY)).toHaveLength(WIRING_REGISTRY.length - CP18_ADDED_IDS.size);
  });
});
