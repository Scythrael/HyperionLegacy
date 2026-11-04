// Complement CP-13 GOLDENS (hull-family module bonuses): the rows and their pre-bonus pins live in
// cp13Goldens.fixture.ts (captured on feat e46d1d3, before the bonus).
//
// CP13_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP13_PINS_PRE, cp13Rows } from "./cp13Goldens.fixture";

const CAPTURE = import.meta.env.CP13_CAPTURE as string | undefined;
const asIs = <T>(run: () => T): T => run();

describe("Complement CP-13 goldens (captured before the hull-family module bonuses)", () => {
  it("every reading matches its pin", () => {
    const now = cp13Rows(asIs);
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP13_PINS_PRE).length).toBeGreaterThan(20);
    expect(now).toEqual(CP13_PINS_PRE);
  }, 600_000);
});
