// Complement CP-16 GOLDENS (the final-retirement warning and the Hall of Command): the rows and their pre-slice pins
// live in cp16Goldens.fixture.ts (captured on feat 9c1f93f, before the slice).
//
// CP16_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP16_PINS_PRE, cp16Rows } from "./cp16Goldens.fixture";
import { asPreCp16, withoutCp16 } from "./cp16Switch.fixture";
import { CP16_ADDED_IDS, cp16ReadBack } from "./cp16Registry.fixture";
import { WIRING_REGISTRY } from "./wiring/registry";
import { patrolUseWearOffForThisFile } from "./patrolUseWearSwitch.fixture";
// Gear wear step 5 (patrol use wear) came after every pin here: the file dispatches its patrols unstamped, so its pins
// keep proving their own slice (gearWearStep5Goldens.test.ts pins what step 5 moved on a patrol).
patrolUseWearOffForThisFile();

const CAPTURE = import.meta.env.CP16_CAPTURE as string | undefined;

// MOVED by the slice (OC-22 and the CP-16 notables answer), each by design; every other row held:
//   mission:ore:*          : the captain counts the six delivered cycles (missionsFlown 6) and reaches level 10 at
//                            game second 50 (the 50th XP), the same in 1 s steps, one call and 997 s chunks.
//   patrol:destroyer       : the won route is a mission flown and the first won wave's XP reaches level 10.
//   patrol:lost            : (fix round, user 2026-11-06 "Count it too") the LOST route is a mission flown too, counted
//                            on the tick the wreck limps home (missionsFlown 1), and its first wave, won before the
//                            loss, reaches level 10; the ending, the wreck's damage and every other byte hold.
//   shortRange:eir:tierOne : the delivered cycle is a mission flown and its XP reaches level 20.
//   evacuation:steps       : the delivered Evacuation is a mission flown and its refugee is the captain's first rescue
//                            (the refugees themselves hold).
//   expedition:*:dispatch  : the dispatch is the captain's first expedition (Tier II also its first Tier II run).
//   expedition:cand-2-0:claim : and its two relics reaching the vault are the captain's first relic found.
//   retire:*               : the retirement appends its Hall of Command entry (the captains hold: the successor carries
//                            no CP-16 record).
//   save                   : the stepped mission state carries the captain's record.
// Held: the refugees of the evacuation. With the CP-16 records taken off (asPreCp16), every row returns to its pin.
const MOVED: Record<string, unknown> = {
  "mission:ore:steps": ["69db926a", "f937d153"],
  "mission:ore:oneCall": ["69db926a", "f937d153"],
  "mission:ore:chunks": ["69db926a", "f937d153"],
  "patrol:destroyer": ["won:14", "a4d32d1b", "5fc5c9db"],
  "patrol:lost": ["lost:20", "bac0ff7a", "509155f3"],
  "shortRange:eir:tierOne": ["904b158e", "7e3029f8"],
  "evacuation:steps": ["a90ebffa", "8d917d09", "4cfbf093"],
  "expedition:cand-0:dispatch": ["8b3d0992", "718506ef"],
  "expedition:cand-2-0:dispatch": ["b1dff332", "61470b55"],
  "expedition:cand-2-0:claim": ["c8faefd1", "325f7044"],
  "retire:first": ["b65eeb44", "c46eaf7c"],
  "retire:final": ["1d197944", "62129c60"],
  "save": ["77260b58", "1ef98ed0"],
};
const PINS: Record<string, unknown> = { ...CP16_PINS_PRE, ...MOVED };

describe("Complement CP-16 goldens (captured before the Hall of Command)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp16Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP16_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(PINS);
  }, 600_000);

  it("with the slice switched off every row returns to its pre-CP-16 pin", () => {
    expect(withoutCp16(() => cp16Rows())).toEqual(CP16_PINS_PRE);
  }, 600_000);

  it("with the CP-16 records taken off every row returns to its pre-CP-16 pin (nothing else moved)", () => {
    expect(cp16Rows(asPreCp16)).toEqual(CP16_PINS_PRE);
  }, 600_000);

  it("the registry read-back names exactly the rows CP-16 added, each live", () => {
    const added = WIRING_REGISTRY.filter((e) => CP16_ADDED_IDS.has(e.id));
    expect(added.map((e) => e.id).sort()).toEqual([...CP16_ADDED_IDS].sort());
    for (const e of added) expect(e.status.kind, e.id).toBe("live");
    expect(cp16ReadBack(WIRING_REGISTRY)).toHaveLength(WIRING_REGISTRY.length - CP16_ADDED_IDS.size);
  });
});
