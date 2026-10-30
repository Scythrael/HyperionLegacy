// WR-7 follow-up OC-D5 favorsSpec GOLDENS FIRST: the rows and their pre-bonus pins live in favorsSpecGoldens.fixture.ts
// (captured on feat 502a0c8, before the favored bonus). Use wear stays off: the pins are about the favored lines.
//
// FAVORS_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
import { FAVORS_PINS_PRE, favorsRows } from "./favorsSpecGoldens.fixture";

gearWearOffInThisFile();

const CAPTURE = import.meta.env.FAVORS_CAPTURE as string | undefined;

describe("OC-D5 favorsSpec goldens", () => {
  it("every reading matches its pin", () => {
    const now = favorsRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(now).toEqual(FAVORS_PINS_PRE);
  }, 600_000);
});
