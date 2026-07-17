// --- Radial Skill Web -- fog-of-war visible-set tests -----------------------
// Author: Radial Skill Web feature (Task 4)
// Created: 2026-07-08 (docs/plans/2026-07-08-radial-skill-web-plan.md, Task 4)
//
// Description:
//   Behavioural spec for computeVisibleTalents (talentWeb.ts). Uses the REAL
//   CAPTAIN_TALENTS graph (Task 2 data) so the tests double as an integration
//   check that the authored `neighbors` wiring reveals what design §2 intends.
//   The Prospector (resourcefulness) branch is the one rich tree, so it drives
//   every case. Its relevant shape (from model.ts):
//
//       prospectorHub (isHub) -- prospectorBulkExtraction -- prospectorRefinedExtraction
//                    \
//                     prospectorKeenEyeI -- prospectorKeenEyeII -- ...
//
//   All adjacency is bidirectional by convention (design §1.1).

import { describe, it, expect } from "vitest";
import { computeVisibleTalents } from "./talentWeb";
import { CAPTAIN_TALENTS } from "./model";

describe("computeVisibleTalents -- fog-of-war reveal", () => {
  it("hub is visible with zero owned; nothing else is", () => {
    // Design §2.2: with an empty owned set the hub is the sole bootstrap seed.
    const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", []);
    expect(vis.has("prospectorHub")).toBe(true);
    expect(vis.has("prospectorBulkExtraction")).toBe(false);
  });

  it("owning the hub reveals its direct neighbors only (not 2 hops out)", () => {
    // hub.neighbors = [prospectorBulkExtraction, prospectorKeenEyeI].
    // prospectorRefinedExtraction is a neighbor of BulkExtraction (2 hops from
    // the hub) and must stay hidden until BulkExtraction itself is owned.
    const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", ["prospectorHub"]);
    expect(vis.has("prospectorBulkExtraction")).toBe(true); // direct neighbor of hub
    expect(vis.has("prospectorKeenEyeI")).toBe(true); // direct neighbor of hub
    expect(vis.has("prospectorRefinedExtraction")).toBe(false); // 2 hops out, still hidden
  });

  it("owning a mid-chain node reveals BOTH of its neighbors", () => {
    // prospectorBulkExtraction.neighbors = [prospectorHub, prospectorRefinedExtraction].
    // Owning it must reveal both ends of the chain around it. The hub is also
    // in the set by the always-visible-seed rule, independent of ownership.
    const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", [
      "prospectorBulkExtraction",
    ]);
    expect(vis.has("prospectorBulkExtraction")).toBe(true); // owned
    expect(vis.has("prospectorHub")).toBe(true); // neighbor (and the hub seed)
    expect(vis.has("prospectorRefinedExtraction")).toBe(true); // neighbor, now revealed
    // The hub being VISIBLE does not reveal the hub's own neighbors -- only
    // OWNING a node reveals its neighbors. The hub is unowned here, so its
    // other neighbor (KeenEyeI) stays hidden; the owned node doesn't touch it.
    expect(vis.has("prospectorKeenEyeI")).toBe(false); // hub neighbor, but hub is unowned -> hidden
    expect(vis.has("prospectorKeenEyeII")).toBe(false); // not adjacent to owned
  });

  it("a node in a DIFFERENT branch is never visible, even if owned is cross-branch", () => {
    // The `branch` filter must exclude other branches' nodes. Pass the tactical
    // hub into a resourcefulness query: it must contribute nothing -- neither
    // itself nor (it has none anyway) its neighbors -- and the resourcefulness
    // hub must still be the visible seed.
    const vis = computeVisibleTalents(CAPTAIN_TALENTS, "resourcefulness", ["tacticianHub"]);
    expect(vis.has("tacticianHub")).toBe(false); // wrong branch, excluded
    expect(vis.has("prospectorHub")).toBe(true); // this branch's hub still seeds
    expect(vis.has("explorerHub")).toBe(false); // also wrong branch
  });
});
