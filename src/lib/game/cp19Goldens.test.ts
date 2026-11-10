// Complement CP-19 GOLDENS (the Personnel Rosters upgrade track): the rows and their pre-slice pins live in
// cp19Goldens.fixture.ts (captured on feat 3a7c544, before the slice).
//
// CP19_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { CP19_PINS_PRE, cp19Rows } from "./cp19Goldens.fixture";

const CAPTURE = import.meta.env.CP19_CAPTURE as string | undefined;

const MOVED: Record<string, unknown> = {};
const PINS: Record<string, unknown> = { ...CP19_PINS_PRE, ...MOVED };

describe("Complement CP-19 goldens (captured before the Personnel Rosters track)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = cp19Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(CP19_PINS_PRE).length).toBeGreaterThan(10);
    expect(now).toEqual(PINS);
  }, 600_000);
});
