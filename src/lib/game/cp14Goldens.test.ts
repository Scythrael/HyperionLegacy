// Complement CP-14 GOLDENS (hull base sensors and Science amplification): the rows and their pre-slice pins live in
// cp14Goldens.fixture.ts (captured on feat 658014c, before the slice).
//
// CP14_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP14_PINS_PRE, cp14Rows } from "./cp14Goldens.fixture";

const CAPTURE = import.meta.env.CP14_CAPTURE as string | undefined;

describe("Complement CP-14 goldens (captured before hull base sensors and Science amplification)", () => {
  it("every reading matches its pin", () => {
    const now = cp14Rows((run) => run());
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP14_PINS_PRE).length).toBeGreaterThan(30);
    expect(now).toEqual(CP14_PINS_PRE);
  }, 600_000);
});
