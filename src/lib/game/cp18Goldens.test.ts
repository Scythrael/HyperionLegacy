// Complement CP-18 GOLDENS (the soft captain level cap): the rows and their pre-slice pins live in cp18Goldens.fixture.ts
// (captured on feat 8d3809b, before the slice).
//
// CP18_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP18_PINS_PRE, cp18Rows } from "./cp18Goldens.fixture";
import { withoutCp18 } from "./cp18Switch.fixture";
import { CP18_ADDED_IDS, cp18ReadBack } from "./cp18Registry.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";

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
const PINS: Record<string, unknown> = { ...CP18_PINS_PRE, ...MOVED };

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
    expect(withoutCp18(() => cp18Rows())).toEqual(CP18_PINS_PRE);
  }, 600_000);

  it("the registry read-back names exactly the row CP-18 added, live", () => {
    const added = WIRING_REGISTRY.filter((e) => CP18_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...CP18_ADDED_IDS].sort());
    for (const e of added) expect(e.status.kind, e.id).toBe("live");
    expect(cp18ReadBack(WIRING_REGISTRY)).toHaveLength(WIRING_REGISTRY.length - CP18_ADDED_IDS.size);
  });
});
