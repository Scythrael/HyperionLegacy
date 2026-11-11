// ORDERING DETERMINISM GOLDENS: the rows and their pre-slice pins live in orderingGoldens.fixture.ts (captured on feat
// 2c66d749, before the slice).
//
// ORDERING_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { ORDERING_PINS_PRE, orderingRows } from "./orderingGoldens.fixture";

const CAPTURE = import.meta.env.ORDERING_CAPTURE as string | undefined;

describe("Ordering determinism goldens (captured before the slice)", () => {
  it("every reading matches its pin", () => {
    const now = orderingRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(ORDERING_PINS_PRE).length).toBe(12);
    expect(now).toEqual(ORDERING_PINS_PRE);
  }, 600_000);
});
