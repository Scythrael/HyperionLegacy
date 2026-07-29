// ============================================================================
// combat/combatView.test.ts: unit coverage for the pure combat-view helpers
// (Combat 0.13.0, Phase 12b Unit C). These pin the small logic decisions the
// combat view UI factors out of the Svelte component, so the display behavior is
// verifiable without a DOM.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  currentReplayWaveIndex,
  buildNameFor,
  rangeMarkerPercent,
  logLineClass,
  dronePips,
} from "./combatView";
import { BAND_LONG } from "./positioning";
import type { CombatEvent } from "./types";
import type { SquadronStatusSummary } from "./drones";

// A minimal CombatEvent factory: only the fields the helper reads matter; the
// rest stay at their optional defaults.
function ev(partial: Partial<CombatEvent>): CombatEvent {
  return { tDeciSec: 0, round: 0, type: "hit", ...partial };
}

describe("currentReplayWaveIndex", () => {
  it("returns null for an empty replay", () => {
    expect(currentReplayWaveIndex(0, 0)).toBe(null);
    expect(currentReplayWaveIndex(3, 0)).toBe(null);
  });
  it("shows the first (upcoming) wave before any wave resolves", () => {
    expect(currentReplayWaveIndex(0, 2)).toBe(0);
  });
  it("shows the most-recently-resolved wave once waves have resolved", () => {
    // nextWaveIndex 1 => wave 0 resolved, still transiting to wave 1 => show 0.
    expect(currentReplayWaveIndex(1, 2)).toBe(0);
    // nextWaveIndex 2 (both resolved / finished a 2-wave patrol) => show 1.
    expect(currentReplayWaveIndex(2, 2)).toBe(1);
  });
  it("clamps a nextWaveIndex past the replay's produced waves (early defeat)", () => {
    // The mission thinks it is on wave 3, but the replay only produced 2 waves
    // (a defeat ended it early): clamp to the last produced wave.
    expect(currentReplayWaveIndex(3, 2)).toBe(1);
  });
});

describe("buildNameFor", () => {
  const nameFor = buildNameFor(
    "ship-1",
    "Ravenscar",
    ["foe-a", "foe-b"],
    ["Raider", "Marauder"],
  );
  it("maps the player id to the player name", () => {
    expect(nameFor("ship-1")).toBe("Ravenscar");
  });
  it("maps each enemy id to its aligned hull label", () => {
    expect(nameFor("foe-a")).toBe("Raider");
    expect(nameFor("foe-b")).toBe("Marauder");
  });
  it("falls back to the raw id for an unknown combatant", () => {
    expect(nameFor("mystery")).toBe("mystery");
  });
  it("falls back to the id when a label is missing", () => {
    const nf = buildNameFor("p", "P", ["x", "y"], ["OnlyLabel"]);
    expect(nf("y")).toBe("y");
  });
});

describe("rangeMarkerPercent", () => {
  it("parks at 0 for zero or negative distance", () => {
    expect(rangeMarkerPercent(0)).toBe(0);
    expect(rangeMarkerPercent(-50)).toBe(0);
  });
  it("scales distance as a percentage of the long-band ceiling", () => {
    expect(rangeMarkerPercent(BAND_LONG)).toBe(100);
    expect(rangeMarkerPercent(Math.round(BAND_LONG / 2))).toBe(50);
  });
  it("clamps a distance beyond long range to 100", () => {
    expect(rangeMarkerPercent(BAND_LONG * 3)).toBe(100);
  });
});

describe("logLineClass", () => {
  it("classes a kill line as destroy (highest priority)", () => {
    expect(logLineClass(ev({ type: "destroyed", crit: true }))).toBe("destroy");
  });
  it("classes a crit hit as crit", () => {
    expect(logLineClass(ev({ type: "hit", crit: true }))).toBe("crit");
  });
  it("classes a DoT tick as dot", () => {
    expect(logLineClass(ev({ type: "dot" }))).toBe("dot");
  });
  it("classes a particle attenuation bleed as atten", () => {
    expect(logLineClass(ev({ type: "hit", attenuated: true }))).toBe("atten");
  });
  it("classes a clean miss as evade", () => {
    expect(logLineClass(ev({ type: "evade" }))).toBe("evade");
  });
  it("leaves a plain hit unclassed", () => {
    expect(logLineClass(ev({ type: "hit" }))).toBe("");
  });
});

describe("dronePips", () => {
  it("expands a REAL summary into one pip per drone, in status order (refab is not double-counted)", () => {
    // A genuine squadronStatusSummary shape: `alive` EXCLUDES refabricating drones (a
    // refabricating drone has alive=false in drones.ts), so alive = online + disrupted = 3,
    // NOT 4. With 2 online + 1 disrupted + 1 refabricating + 1 destroyed = 5 total, the
    // destroyed count must be 1. The old `total - alive` (5 - 3 = 2) would render a SECOND
    // offline pip for the refabricating drone (the double-count bug); the fix renders 5 pips.
    const summary: SquadronStatusSummary = {
      total: 5,
      alive: 3,
      online: 2,
      disrupted: 1,
      refabricating: 1,
    };
    const pips = dronePips(summary);
    expect(pips.map((p) => p.cls)).toEqual([
      "online",
      "online",
      "disrupted",
      "refab",
      "offline", // exactly ONE destroyed (5 - 2 online - 1 disrupted - 1 refab)
    ]);
  });
  it("returns no pips for an empty squadron", () => {
    expect(
      dronePips({ total: 0, alive: 0, online: 0, disrupted: 0, refabricating: 0 }),
    ).toEqual([]);
  });
  it("renders all-destroyed as offline pips", () => {
    const pips = dronePips({
      total: 3,
      alive: 0,
      online: 0,
      disrupted: 0,
      refabricating: 0,
    });
    expect(pips.map((p) => p.cls)).toEqual(["offline", "offline", "offline"]);
  });
});
