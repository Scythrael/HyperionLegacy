// Completion tracking (0.14.0): the display decisions (completionDisplay.ts) over the engine's one completion function.

import { describe, expect, it } from "vitest";
import { systemCompletion, type SystemRow } from "./game/completion";
import type { CompletionBodyTally, RegionTier } from "./game/model";
import {
  MAP_COMPLETION_LEGEND,
  SYSTEMS_FOOT,
  bodyCompletionText,
  claimCompletionText,
  completionLineView,
  mapCompletionView,
  resumeCompletionText,
  ringDash,
  systemsSectionView,
  visitedChip,
} from "./completionDisplay";

const body = (scanned: boolean, objectives = 0, done = 0, skipped = 0): CompletionBodyTally => ({ scanned, objectives, done, skipped });

function row(id: string, tier: RegionTier, bodies: CompletionBodyTally[], at: number, state: SystemRow["state"] = null, extra: Partial<SystemRow> = {}): SystemRow {
  return { systemId: id, systemName: id, tier, realStar: false, enemyTerritory: false, completion: systemCompletion({ bodies, nebula: null }), state, at, ...extra };
}

describe("the console line (Q7 A)", () => {
  it("Bodies 2/3 · Objectives 3/5 · 50%, the ring and the accessible name", () => {
    const v = completionLineView(systemCompletion({ bodies: [body(true, 3, 3), body(true, 2), body(false)], nebula: null }));
    expect(v).toMatchObject({ bodiesText: "2/3", objectivesText: "3/5", percentText: "50%", complete: false });
    expect(v.ringDash).toBe(ringDash(50));
    expect(v.ariaLabel).toBe("Completion 50%: 2 of 3 bodies scanned, 3 of 5 objectives done");
  });
  it("skips are noted", () => {
    const v = completionLineView(systemCompletion({ bodies: [body(true, 3, 2, 1)], nebula: null }));
    expect(v.objectivesText).toBe("2/3 · 1 skipped");
    expect(v.complete).toBe(true);
    expect(v.ariaLabel).toContain("1 skipped");
  });
  it("the ring dash on its 6 px radius", () => {
    expect(ringDash(0)).toBe("0.0 37.7");
    expect(ringDash(100)).toBe("37.7 37.7");
  });
});

describe("body lines, the claim line, the Resume number, the visited chip", () => {
  it("each body's line, as the mockup's note words it", () => {
    const c = systemCompletion({ bodies: [body(true, 3, 3), body(true, 2), body(false), body(true), body(true, 2, 1, 1)], nebula: null });
    expect(c.bodyLines.map(bodyCompletionText)).toEqual([
      "Scanned · Objectives 3/3 · 100%",
      "Scanned · Objectives 0/2 · 50%",
      "Not scanned yet · objectives appear when the scan ends · 0%",
      "Scanned · No objectives · 100%",
      "Scanned · Objectives 1/2 · 1 skipped · 100%",
    ]);
  });
  it("the claim card's line only at 100% (Q10 B, verbatim)", () => {
    expect(claimCompletionText("Betelgeuse", systemCompletion({ bodies: [body(true, 1, 1)], nebula: null }))).toBe("Betelgeuse completed: every body scanned, every objective done.");
    expect(claimCompletionText("Betelgeuse", systemCompletion({ bodies: [body(true, 1)], nebula: null }))).toBeNull();
  });
  it("the Resume card's one number (Q9 A)", () => {
    expect(resumeCompletionText(systemCompletion({ bodies: [body(true, 2, 1), body(false), body(false)], nebula: null }))).toBe("25% · Bodies 1/3 · Objectives 1/2");
  });
  it("Visited: N% or the badge (Q2 B)", () => {
    expect(visitedChip(null)).toBeNull();
    expect(visitedChip(systemCompletion({ bodies: [body(true, 2, 1)], nebula: null }))).toEqual({ complete: false, text: "Visited: 75%" });
    expect(visitedChip(systemCompletion({ bodies: [body(true)], nebula: null }))).toEqual({ complete: true, text: "Completed" });
  });
});

describe("the Survey Log's Systems section (Q8 A)", () => {
  const rows = [
    row("LB-0375", 1, [body(true, 2, 2)], 10),
    row("LB-1467", 1, [body(true, 2, 1), body(false)], 40, "inResume"),
    row("OR-9359", 2, [body(true, 3, 3), body(true, 2), body(false)], 50, "underWay"),
    row("SA-2394", 4, [body(true, 6, 2, 4)], 30, null, { enemyTerritory: true }),
    row("Eagle Nebula", 4, [body(true, 2)], 20, "abandoned", { realStar: true }),
  ];
  it("grouped by tier, nearest first, each group by completion, with Roman numerals and counts", () => {
    const v = systemsSectionView(rows, "tier");
    expect([v.visited, v.completed, v.empty]).toEqual([5, 2, false]);
    expect(v.groups.map((g) => [g.heading, g.countText])).toEqual([
      ["Tier I · Local Bubble", "2 systems · 1 completed"],
      ["Tier II · Orion Arm", "1 system · 0 completed"],
      ["Tier IV · Sagittarius Arm", "2 systems · 1 completed"],
    ]);
    expect(v.groups[2].rows.map((r) => [r.name, r.percent, r.complete, r.objectivesText, r.skippedText, r.stateText, r.enemyTerritory, r.realStar])).toEqual([
      ["SA-2394", 100, true, "2/6", "4 skipped", null, true, false],
      ["Eagle Nebula", 50, false, "0/2", null, "Abandoned", false, true],
    ]);
    expect(v.groups[0].rows[1].stateText).toBe("In Resume");
    expect(v.groups[1].rows[0].stateText).toBe("Under way");
  });
  it("by completion and newest first flatten the list", () => {
    expect(systemsSectionView(rows, "completion").groups[0].rows.map((r) => r.name)).toEqual(["SA-2394", "LB-0375", "OR-9359", "Eagle Nebula", "LB-1467"]);
    expect(systemsSectionView(rows, "newest").groups[0].rows.map((r) => r.name)).toEqual(["OR-9359", "LB-1467", "SA-2394", "Eagle Nebula", "LB-0375"]);
  });
  it("empty until a system is visited; the foot says the list starts at the update (Q5 A)", () => {
    expect(systemsSectionView([], "tier")).toEqual({ visited: 0, completed: 0, groups: [], empty: true });
    expect(SYSTEMS_FOOT).toBe("Listed from this update on. Systems claimed before it left no record.");
  });
});

describe("the telescope map's region arcs (Q6 B)", () => {
  const badges = [1, 2, 3, 4].map((t) => ({ tier: t as RegionTier, x: t * 10, y: t * 20 }));
  it("an arc per region with a listed system, its share completed; the key lines and the legend", () => {
    const rows = [row("a", 1, [body(true)], 0), row("b", 1, [body(false)], 0), row("c", 2, [body(false)], 0)];
    const v = mapCompletionView(badges, rows);
    expect(v.arcs.map((a) => [a.tier, a.charted, a.completed, a.dash])).toEqual([
      [1, 2, 1, ringDash(50, 12.5)],
      [2, 1, 0, null],
    ]);
    expect([...v.keyText.entries()]).toEqual([
      [1, "2 charted · 1 completed"],
      [2, "1 charted · 0 completed"],
    ]);
    expect(v.legend).toBe(MAP_COMPLETION_LEGEND);
    expect(v.ariaSentence).not.toBe("");
  });
  it("nothing on the map before a system is visited", () => {
    expect(mapCompletionView(badges, [])).toMatchObject({ arcs: [], legend: null, ariaSentence: "" });
  });
});

describe("player text", () => {
  it("says objective, never task; no em dashes", () => {
    const texts = [SYSTEMS_FOOT, MAP_COMPLETION_LEGEND, bodyCompletionText({ ...body(false), percent: 0, complete: false })];
    for (const t of texts) {
      expect(t).not.toMatch(/\btasks?\b/i);
      expect(t).not.toMatch(/\u2014|-{2}/);
    }
  });
});
