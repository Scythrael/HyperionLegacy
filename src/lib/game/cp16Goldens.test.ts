// Complement CP-16 GOLDENS (the final-retirement warning and the Hall of Command): the rows and their pre-slice pins
// live in cp16Goldens.fixture.ts (captured on feat 9c1f93f, before the slice).
//
// CP16_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP16_PINS_PRE, cp16Rows } from "./cp16Goldens.fixture";

const CAPTURE = import.meta.env.CP16_CAPTURE as string | undefined;

describe("Complement CP-16 goldens (captured before the Hall of Command)", () => {
  it("every reading matches its pin", () => {
    const now = cp16Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP16_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(CP16_PINS_PRE);
  }, 600_000);
});
