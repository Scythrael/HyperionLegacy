// ORDERING DETERMINISM GOLDENS: the rows and their pre-slice pins live in orderingGoldens.fixture.ts (captured on feat
// 2c66d749, before the slice).
//
// ORDERING_CAPTURE = an output path: record every row instead of asserting.

// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { ORDERING_PINS_PRE, orderingRows } from "./orderingGoldens.fixture";
import { asCanonicalOrder, withCanonicalOrderOff } from "./orderingSwitch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();

const CAPTURE = import.meta.env.ORDERING_CAPTURE as string | undefined;

// MOVED by the slice (canonicalOrder.ts), every row, each by design and in ORDER only: `discovered` and the four tally
// maps' keys now stand in canonical (code unit) order, so the three chunkings of each run land on ONE state:
//   patrol:*      : the steps met intactReactorCore, powerCoupling, commonOre, titaniumIngot; one call and the chunks met
//                   commonOre first. All three now list commonOre, intactReactorCore, powerCoupling, titaniumIngot, and
//                   itemsGathered follows the same order.
//   shortRange:*  : the steps met rareMaterial first, one call and the chunks commonOre; all three now list commonOre,
//                   rareMaterial. itemsGathered and missionsCompleted (seven short-range jobs) are in code unit order.
//   twoCaptains:* : the steps completed shortOreRun first, one call and the chunks folded longOreRun first; all three now
//                   key longOreRun, shortOreRun. itemsGathered is in code unit order.
//   offline:*     : (already equal across tick, 1 s steps and 97 s chunks) the same canonical keys.
// Every value holds: with the switch off every row returns to its pin, and the switch-off rows read through
// asCanonicalOrder equal these (the trace: nothing but order moved).
const MOVED: Record<string, unknown> = {
  "patrol:steps": ["12f48ea7", "commonOre,intactReactorCore,powerCoupling,titaniumIngot", "commonOre,intactReactorCore,powerCoupling,titaniumIngot |  |  | crimsonReaverSweep"],
  "patrol:oneCall": ["12f48ea7", "commonOre,intactReactorCore,powerCoupling,titaniumIngot", "commonOre,intactReactorCore,powerCoupling,titaniumIngot |  |  | crimsonReaverSweep"],
  "patrol:chunks": ["12f48ea7", "commonOre,intactReactorCore,powerCoupling,titaniumIngot", "commonOre,intactReactorCore,powerCoupling,titaniumIngot |  |  | crimsonReaverSweep"],
  "shortRange:steps": ["17b8dc2f", "commonOre,rareMaterial", "commonOre,rareMaterial |  |  | shortRange:commBoosterBuild,shortRange:phenomenonSurvey,shortRange:prisonerTransport,shortRange:refugeeRelocation,shortRange:supplyDropOff,shortRange:supplyPickup,shortRange:telescopeRepair"],
  "shortRange:oneCall": ["17b8dc2f", "commonOre,rareMaterial", "commonOre,rareMaterial |  |  | shortRange:commBoosterBuild,shortRange:phenomenonSurvey,shortRange:prisonerTransport,shortRange:refugeeRelocation,shortRange:supplyDropOff,shortRange:supplyPickup,shortRange:telescopeRepair"],
  "shortRange:chunks": ["17b8dc2f", "commonOre,rareMaterial", "commonOre,rareMaterial |  |  | shortRange:commBoosterBuild,shortRange:phenomenonSurvey,shortRange:prisonerTransport,shortRange:refugeeRelocation,shortRange:supplyDropOff,shortRange:supplyPickup,shortRange:telescopeRepair"],
  "twoCaptains:steps": ["42d9cdf8", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
  "twoCaptains:oneCall": ["42d9cdf8", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
  "twoCaptains:chunks": ["42d9cdf8", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
  "offline:tick": ["2e56590d", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
  "offline:steps": ["2e56590d", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
  "offline:chunks97": ["2e56590d", "commonOre,ferriteOre", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial |  |  | longOreRun,shortOreRun"],
};

describe("Ordering determinism goldens (captured before the slice)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = orderingRows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(ORDERING_PINS_PRE).length).toBe(12);
    expect(now).toEqual({ ...ORDERING_PINS_PRE, ...MOVED });
  }, 600_000);

  it("with the slice switched off every row returns to its pre-slice pin", () => {
    expect(withCanonicalOrderOff(() => orderingRows())).toEqual(ORDERING_PINS_PRE);
  }, 600_000);

  it("the switch-off rows put in canonical order are the slice's rows (order is all it moved)", () => {
    expect(withCanonicalOrderOff(() => orderingRows(asCanonicalOrder))).toEqual(MOVED);
  }, 600_000);

  it("each run's three chunkings agree after the slice, and differed before it", () => {
    const now = orderingRows();
    for (const run of ["patrol", "shortRange", "twoCaptains"]) {
      expect(now[`${run}:oneCall`]).toEqual(now[`${run}:steps`]);
      expect(now[`${run}:chunks`]).toEqual(now[`${run}:steps`]);
      expect(ORDERING_PINS_PRE[`${run}:oneCall`]).not.toEqual(ORDERING_PINS_PRE[`${run}:steps`]);
    }
  }, 600_000);
});
