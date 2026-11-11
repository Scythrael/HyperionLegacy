// ORDERING DETERMINISM PART 2 GOLDENS: the rows and their pre-part-2 pins live in ordering2Goldens.fixture.ts (captured
// on feat 29993f09, before part 2).
//
// ORDERING2_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { ORDERING2_PINS_PRE, ordering2Rows } from "./ordering2Goldens.fixture";

const CAPTURE = process.env.ORDERING2_CAPTURE;

describe("Ordering determinism part 2 goldens (captured before part 2)", () => {
  it("every reading matches its pin", () => {
    const now = ordering2Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(ORDERING2_PINS_PRE).length).toBe(18);
    expect(now).toEqual(ORDERING2_PINS_PRE);
  }, 600_000);
});
