// Complement CP-18 GOLDENS (the soft captain level cap): the rows and their pre-slice pins live in cp18Goldens.fixture.ts
// (captured on feat 8d3809b, before the slice).
//
// CP18_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP18_PINS_PRE, cp18Rows } from "./cp18Goldens.fixture";

const CAPTURE = import.meta.env.CP18_CAPTURE as string | undefined;

describe("Complement CP-18 goldens (captured before the soft level cap)", () => {
  it("every reading matches its pin", () => {
    const now = cp18Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP18_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(CP18_PINS_PRE);
  }, 600_000);
});
