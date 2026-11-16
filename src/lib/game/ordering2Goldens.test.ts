// ORDERING DETERMINISM PART 2 GOLDENS: the rows and their pre-part-2 pins live in ordering2Goldens.fixture.ts (captured
// on feat 29993f09, before part 2).
//
// ORDERING2_CAPTURE = an output path: record every row instead of asserting.

import { describe, expect, it } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
recapFoldsOffForThisFile();
import { writeFileSync } from "node:fs";
import { ORDERING2_PINS_PRE, ordering2Rows } from "./ordering2Goldens.fixture";
import { asOrdering2Normalized, withOrdering2Off } from "./ordering2Switch.fixture";
// Homeworld reserve (user 2026-11-12; homeworldReserve.ts): this file's pins were captured before the reserve and hash a
// fleet whose surplus crew the reserve now moves out of the pool, so the whole file runs with it off and its pins keep
// proving their own slice (switch-off reproduction: every pin holds with it off). homeworldReserveGoldens pins the reserve.
import { homeworldReserveOffForThisFile } from "./homeworldReserveSwitch.fixture";
homeworldReserveOffForThisFile();

const CAPTURE = import.meta.env.ORDERING2_CAPTURE as string | undefined;

// MOVED by part 2 (canonicalOrder.ts), by design and in ORDER only:
//   patrol:*, twoCaptains:*, oldSave:* : (already equal across the three chunkings) a new inventory key now puts the
//                 whole map in canonical (code unit) order, so the seeded commonOre, uncommonMaterial, rareMaterial and
//                 an older save's first-seen keys (titaniumIngot, deuteriumIce) sort with the new finds.
//   salvage:*   : the steps added polysilicateWafer before titaniumIngot, one call and the chunks after it; all three
//                 now hold the one canonical order.
//   relics:oneCall, relics:chunks : one call logged the four studies in array order (the reverse of completion), the
//                 chunks in a mix; both now log them in completion order, as the steps did (relics:steps is unmoved).
//   processes:* : one call and the chunks logged the five completions (and added the two refined items) in array
//                 order; all three now log research, polysilicateWafer, the study, titaniumIngot, salvageBay (completion
//                 order) and hold the inventory in canonical order.
// Every value holds: with the switch off every row returns to its pin, and the rows of both, read through
// asOrdering2Normalized, are equal (the trace: nothing but order moved).
const MOVED: Record<string, unknown> = {
  "patrol:steps": ["401f163d", "commonOre,intactReactorCore,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:patrolRun:crimsonReaverSweep"],
  "patrol:oneCall": ["401f163d", "commonOre,intactReactorCore,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:patrolRun:crimsonReaverSweep"],
  "patrol:chunks": ["401f163d", "commonOre,intactReactorCore,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:patrolRun:crimsonReaverSweep"],
  "twoCaptains:steps": ["a8619222", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial", ""],
  "twoCaptains:oneCall": ["a8619222", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial", ""],
  "twoCaptains:chunks": ["a8619222", "commonOre,denseOre,ferriteOre,osmiumOre,rareMaterial,uncommonMaterial", ""],
  "salvage:steps": ["143ca5a9", "commonOre,damagedWeaponSystem,intactReactorCore,polysilicateWafer,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "salvage:oneCall": ["143ca5a9", "commonOre,damagedWeaponSystem,intactReactorCore,polysilicateWafer,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "salvage:chunks": ["143ca5a9", "commonOre,damagedWeaponSystem,intactReactorCore,polysilicateWafer,powerCoupling,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:salvageJob:damagedWeaponSystem,done-2:patrolRun:crimsonReaverSweep"],
  "relics:oneCall": ["aa5e06ef", "commonOre,uncommonMaterial,rareMaterial", "done-1:relicStudy:hullRivet,done-2:relicStudy:resonanceShard,done-3:relicStudy:flightRecorder,done-4:relicStudy:starChartFragment"],
  "relics:chunks": ["aa5e06ef", "commonOre,uncommonMaterial,rareMaterial", "done-1:relicStudy:hullRivet,done-2:relicStudy:resonanceShard,done-3:relicStudy:flightRecorder,done-4:relicStudy:starChartFragment"],
  "processes:steps": ["3dd78f5", "commonOre,polysilicateWafer,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:facilityUpgrade:research,done-2:refineJob:polysilicateWafer,done-3:relicStudy:resonanceShard,done-4:refineJob:titaniumIngot,done-5:facilityUpgrade:salvageBay"],
  "processes:oneCall": ["3dd78f5", "commonOre,polysilicateWafer,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:facilityUpgrade:research,done-2:refineJob:polysilicateWafer,done-3:relicStudy:resonanceShard,done-4:refineJob:titaniumIngot,done-5:facilityUpgrade:salvageBay"],
  "processes:chunks": ["3dd78f5", "commonOre,polysilicateWafer,rareMaterial,titaniumIngot,uncommonMaterial", "done-1:facilityUpgrade:research,done-2:refineJob:polysilicateWafer,done-3:relicStudy:resonanceShard,done-4:refineJob:titaniumIngot,done-5:facilityUpgrade:salvageBay"],
  "oldSave:steps": ["94d51ca7", "commonOre,denseOre,deuteriumIce,ferriteOre,osmiumOre,rareMaterial,titaniumIngot,uncommonMaterial", ""],
  "oldSave:oneCall": ["94d51ca7", "commonOre,denseOre,deuteriumIce,ferriteOre,osmiumOre,rareMaterial,titaniumIngot,uncommonMaterial", ""],
  "oldSave:chunks": ["94d51ca7", "commonOre,denseOre,deuteriumIce,ferriteOre,osmiumOre,rareMaterial,titaniumIngot,uncommonMaterial", ""],
};

describe("Ordering determinism part 2 goldens (captured before part 2)", () => {
  it("every reading matches its pin (moves are named in MOVED)", () => {
    const now = ordering2Rows();
    if (CAPTURE) {
      writeFileSync(CAPTURE, JSON.stringify(now, null, 2));
      return;
    }
    expect(Object.keys(ORDERING2_PINS_PRE).length).toBe(18);
    expect(Object.keys(MOVED).length).toBe(17);
    expect(now).toEqual({ ...ORDERING2_PINS_PRE, ...MOVED });
  }, 600_000);

  it("with part 2 switched off every row returns to its pre-part-2 pin", () => {
    expect(withOrdering2Off(() => ordering2Rows())).toEqual(ORDERING2_PINS_PRE);
  }, 600_000);

  it("order is all it moved: the rows with both orders normalized are the same switched on and off", () => {
    const on = ordering2Rows(asOrdering2Normalized);
    expect(withOrdering2Off(() => ordering2Rows(asOrdering2Normalized))).toEqual(on);
  }, 600_000);

  it("each run's three chunkings agree after part 2, and the salvage, relic and process runs differed before it", () => {
    const now = ordering2Rows();
    for (const run of ["patrol", "twoCaptains", "salvage", "relics", "processes", "oldSave"]) {
      expect(now[`${run}:oneCall`], run).toEqual(now[`${run}:steps`]);
      expect(now[`${run}:chunks`], run).toEqual(now[`${run}:steps`]);
    }
    for (const run of ["salvage", "relics", "processes"]) expect(ORDERING2_PINS_PRE[`${run}:oneCall`], run).not.toEqual(ORDERING2_PINS_PRE[`${run}:steps`]);
  }, 600_000);
});
