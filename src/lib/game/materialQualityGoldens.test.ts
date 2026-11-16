// ML-3 + ML-4 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 "ML-3 Material quality on
// delivery (OC-D2)" and "ML-4 Quality carries into crafts"): golden hashes captured on feat/crew-0.14.0 (f85ef73)
// BEFORE either slice touches the engine (the ML-0 / CP-0 pattern). Each capture is the whole state (stateHash) plus
// the number of draws the run took from the SHARED injected rng, which neither slice may change.
//
//   refineMixed  : a refine line (Titanium Ore into Titanium Ingot) on stock spread over Q0 to Q2. ML-4 MOVES it by
//                  design (the carried quality lifts the output); stripping every job's carried quality as the run
//                  goes reproduces the capture (the consumption, lowest-first, is unchanged).
//   fabMixed     : a material fabricate line (Frame Segment) on Titanium Ingot stock at Q0 and Q3. Same as above.
//   inFlight     : a refine job already IN FLIGHT when the slice lands (started without a carried quality), on mixed
//                  stock, completing. Must HOLD: an in-flight job resolves exactly as it was started.
//   queued       : a queued refine order on Q0 stock, promoted by the tick and run through. Must HOLD.
//   rigAssayer   : a Prospector Miner with a crafted Refinery-Feed Rig, flown by a captain who owns Assayer, on the
//                  Local Asteroid run. ML-3 MOVES it (the rig's climb); the rig's climb chance at 0 reproduces it.
//   rigSalvage   : the same rig on Salvage Wreckage (several delivered items per cycle). ML-3 moves it the same way.

// The ordering determinism slice (canonicalOrder.ts: `discovered` and the lifetime tally maps kept in canonical order)
// came after every pin here: the file runs with it off (orderingSwitch.fixture.ts), so its pins keep proving their own
// slice (orderingGoldens.test.ts pins the order move and proves it moved order only).
import { canonicalOrderOffForThisFile } from "./orderingSwitch.fixture";
canonicalOrderOffForThisFile();
// Ordering determinism part 2 (canonicalOrder.ts: inventory keys and a call's completion log in one order) came after every pin here, traced order-only: the file runs with it off (ordering2Switch.fixture.ts).
import { ordering2OffForThisFile } from "./ordering2Switch.fixture";
ordering2OffForThisFile();
// FR-C lane 1 I3 (the lane join wired: startLine opens an order for a batch) came after every pin here: the file runs with
// it off (laneJoinSwitch.fixture.ts), so its pins keep proving their own slice; laneJoinWired.test.ts traces the move.
import { laneJoinOffForThisFile } from "./laneJoinSwitch.fixture";
laneJoinOffForThisFile();
import { describe, expect, it } from "vitest";
// FR-C R2-5 / R8-6 (the finite-work FA XP folded into lifetimeStats, the auto-salvage log stamp) came after every pin
// here: the file runs with them off (recapFoldsSwitch.fixture.ts), so its pins keep proving their own slice;
// faXpAwardedStat.test.ts and offlineRecapSections.test.ts pin the moves.
import { recapFoldsOffForThisFile } from "./recapFoldsSwitch.fixture";
recapFoldsOffForThisFile();
// FR-C lane 1 M5 / M6 (Never discard: deliveries land in full, a load trims nothing) came after every pin here: the file
// runs with it off (neverDiscardSwitch.fixture.ts), so its pins keep proving their own slice; neverDiscard.test.ts pins
// the move.
import { neverDiscardOffForThisFile } from "./neverDiscardSwitch.fixture";
neverDiscardOffForThisFile();
import { cp16OffForThisFile } from "./cp16Switch.fixture";
// Complement CP-16 (the Hall of Command) came after every pin here: the file runs with the slice off, so its pins
// keep proving their own slice (cp16Goldens.test.ts pins what CP-16 moved: the missions counter, the notables and
// the Hall of Command entry).
cp16OffForThisFile();
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { enqueueOrder } from "./tick";
import { stateHash } from "./firstRunsGoldens.fixture";
import { withFavoredSpecOff } from "./favoredSpecSwitch.fixture";
import { MIXED_INGOT, MIXED_ORE, craftStateQ, lineQ, rigFleet, rigRun, steppedQ, stripCarry, withMaterialQualityOff } from "./materialQualityGoldens.fixture";

const ML34_GOLDEN = {
  refineMixed: "c43a66c9:5",
  fabMixed: "bd8b3770:2",
  inFlight: "fd35919d:1",
  queued: "48881028:3",
  rigAssayer: "70acbd33:1104",
  rigSalvage: "e3ca4f2a:819",
};

// Re-pinned by ML-3 (by design: the rig's climb lifts part of each delivery one quality step and the captain's
// lifetime counter steps; the shared draw count is unchanged). ML34_GOLDEN above stays the pre-change capture, and
// the rig's climb chance at 0 (withMaterialQualityOff) reproduces it (asserted below).
// Re-pinned by ML-4 (by design: each job stamps the unit-weighted average quality it consumed, rounded down, and its
// output lands that much higher; the consumption itself, lowest-first, and the shared draw count are unchanged).
// Stripping every job's carried quality as the run goes (stripCarry) reproduces ML34_GOLDEN (asserted below).
const ML4_CRAFT = {
  refineMixed: "a653ebe5:5",
  fabMixed: "44bb89ca:2",
};

const ML3_RIG = {
  rigAssayer: "87121346:1104",
  rigSalvage: "c057cdeb:819",
};
// Re-pinned by the WR-7 follow-up OC-D5 favorsSpec ("+10% on its ship type", user 2026-10-29): the Refinery-Feed Rig
// favors the Prospector spec, so on the Prospector Miner every line counts +10% (a higher climb chance, more yield);
// the shared draw count is unchanged. With the bonus switched off (withFavoredSpecOff) each row is ML3_RIG again.
const OC_D5_RIG = {
  rigAssayer: "c52ca533:1104",
  rigSalvage: "d02e9efc:819",
};

describe("ML-3 + ML-4 pre-change goldens", () => {
  it("refineMixed: a refine line on Q0 to Q2 stock", () => {
    const s0 = lineQ(craftStateQ(MIXED_ORE, []), "refine", "refineCommonOre", { kind: "batch", remaining: 5 });
    const { state, draws } = steppedQ(s0, 80, 0x2e3);
    expect(state.refineLines).toHaveLength(0);
    expect(`${stateHash(state)}:${draws}`).toEqual(ML4_CRAFT.refineMixed);
    const off = steppedQ(s0, 80, 0x2e3, stripCarry);
    expect(`${stateHash(off.state)}:${off.draws}`).toEqual(ML34_GOLDEN.refineMixed);
  });

  it("fabMixed: a material fabricate line on Q0 and Q3 stock", () => {
    const s0 = lineQ(craftStateQ(MIXED_INGOT, ["frameSegmentBp"]), "fabricate", "frameSegmentBp", { kind: "batch", remaining: 2 });
    const { state, draws } = steppedQ(s0, 300, 0xfad);
    expect(state.fabricateLines).toHaveLength(0);
    expect(`${stateHash(state)}:${draws}`).toEqual(ML4_CRAFT.fabMixed);
    const off = steppedQ(s0, 300, 0xfad, stripCarry);
    expect(`${stateHash(off.state)}:${off.draws}`).toEqual(ML34_GOLDEN.fabMixed);
  });

  it("inFlight: a refine job started before the slice completes as it was started", () => {
    const s0 = lineQ(craftStateQ({ commonOre: [10, 0, 20] }, []), "refine", "refineCommonOre", { kind: "batch", remaining: 1 });
    const started = stripCarry(steppedQ(s0, 1, 0x1f1).state);
    expect(started.activeProcesses).toHaveLength(1);
    const { state, draws } = steppedQ(started, 40, 0x1f3);
    expect(state.activeProcesses).toHaveLength(0);
    expect(`${stateHash(state)}:${draws}`).toEqual(ML34_GOLDEN.inFlight);
  });

  it("queued: a queued refine order on Q0 stock, promoted and run through", () => {
    const q = enqueueOrder(craftStateQ({ commonOre: [60] }, []), "refinery", { type: "craftLine", kind: "refine", recipeKey: "refineCommonOre", mode: { kind: "batch", remaining: 3 } });
    expect(q.queued).toBe(true);
    const { state, draws } = steppedQ(q.next, 60, 0x3a7);
    expect(state.processQueue).toHaveLength(0);
    expect(`${stateHash(state)}:${draws}`).toEqual(ML34_GOLDEN.queued);
  });

  it("rigAssayer: a Refinery-Feed Rig ship flown by an Assayer captain on the Local Asteroid run", () => {
    expect(rigRun(rigFleet(["extraction4"]), "shortOreRun", 0x7eb)).toEqual(OC_D5_RIG.rigAssayer);
    expect(withFavoredSpecOff(() => rigRun(rigFleet(["extraction4"]), "shortOreRun", 0x7eb))).toEqual(ML3_RIG.rigAssayer);
    expect(withFavoredSpecOff(() => withMaterialQualityOff(() => rigRun(rigFleet(["extraction4"]), "shortOreRun", 0x7eb)))).toEqual(ML34_GOLDEN.rigAssayer);
  });

  it("rigSalvage: a Refinery-Feed Rig ship on Salvage Wreckage", () => {
    expect(rigRun(rigFleet(), "salvageWreckage", 0x7ed)).toEqual(OC_D5_RIG.rigSalvage);
    expect(withFavoredSpecOff(() => rigRun(rigFleet(), "salvageWreckage", 0x7ed))).toEqual(ML3_RIG.rigSalvage);
    expect(withFavoredSpecOff(() => withMaterialQualityOff(() => rigRun(rigFleet(), "salvageWreckage", 0x7ed)))).toEqual(ML34_GOLDEN.rigSalvage);
  });
});
