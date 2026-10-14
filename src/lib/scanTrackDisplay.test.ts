// GO-15: the per-body SCAN TRACK (scanTrackDisplay.ts): one pip per recorded scan event on a body (a flagged run's
// ship events and supply caches; a legacy run's ground battles and supply caches), each with its outcome, its pause
// and a plain-words log line; plus the key row of the kinds a run shows. Hand-written event records in the engine's
// shape (model.ts ExpeditionScanEvent), so every rare outcome (a boarding, a cloaked vessel) is covered. Display
// only: nothing here changes a rule.

import { describe, expect, it } from "vitest";
import type { Expedition, ExpeditionScanEvent } from "./game/model";
import { BOARDING_PAUSE_SECONDS, DEBRIS_DELAY_SECONDS, PROBE_REPAIR_SECONDS } from "./game/shipScanEvents";
import { ICON_SEMANTICS } from "./ui/iconPacks";
import { scanTrackKey, scanTrackView, type ScanTrackRun } from "./scanTrackDisplay";

// A run with ship events (the flag: groundOps.shipEventProfile.battle), one body half scanned.
function shipRun(events: ExpeditionScanEvent[], findings: Expedition["findings"] = []): ScanTrackRun {
  return {
    encounterSteps: 10,
    scanEvents: events,
    findings,
    bodies: [
      { id: "b0", planetType: "terrestrial", scanTotal: 100, scanProgress: 50, hazard: 0.2, scanned: false, discoveries: [], activities: [] },
      { id: "b1", planetType: "volcanic", scanTotal: 100, scanProgress: 0, hazard: 0.4, scanned: false, discoveries: [], activities: [] },
    ],
    groundOps: { shipEventProfile: { battle: {} } } as unknown as Expedition["groundOps"],
  };
}
function legacyRun(events: ExpeditionScanEvent[], findings: Expedition["findings"] = []): ScanTrackRun {
  return { ...shipRun(events, findings), groundOps: undefined };
}

const NO_EM_DASH = new RegExp(String.fromCharCode(0x2014) + "|-{2}"); // an em dash, or two hyphens standing in for one

describe("scanTrackView: the pips", () => {
  it("places one pip per event of that body at step / encounterSteps, in scan order, with the scanned share", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 4, kind: "shipEvent", event: "storm", outcome: "pass" },
      { bodyIndex: 0, step: 2, kind: "shipEvent", event: "debris", outcome: "pass" },
      { bodyIndex: 1, step: 3, kind: "shipEvent", event: "storm", outcome: "pass" },
    ]);
    const v = scanTrackView(run, 0)!;
    expect(v.pips.map((p) => [p.step, p.posPct])).toEqual([
      [2, 20],
      [4, 40],
    ]);
    expect(v.scannedPct).toBe(50);
    expect(scanTrackView(run, 1)!.pips.map((p) => p.step)).toEqual([3]);
  });

  it("is null on a run dispatched before scan steps existed (no encounterSteps)", () => {
    expect(scanTrackView({ ...shipRun([]), encounterSteps: undefined }, 0)).toBeNull();
  });

  it("says plainly when nothing has happened yet, and when the body finished calm", () => {
    const run = shipRun([]);
    expect(scanTrackView(run, 0)!.emptyText).toBe("No scan events yet.");
    run.bodies[0] = { ...run.bodies[0], scanProgress: 100, scanned: true };
    expect(scanTrackView(run, 0)!.emptyText).toBe("No scan events: a calm scan.");
    expect(scanTrackView(shipRun([{ bodyIndex: 0, step: 1, kind: "supplyCache" }]), 0)!.emptyText).toBeNull();
  });

  it("debris: steered clear is good and costs nothing; a hit pauses the scan and wears the hull", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 1, kind: "shipEvent", event: "debris", outcome: "pass" },
      { bodyIndex: 0, step: 2, kind: "shipEvent", event: "debris", outcome: "fail", pauseSeconds: DEBRIS_DELAY_SECONDS, hullWear: 12 },
    ]);
    const [clear, hit] = scanTrackView(run, 0)!.pips;
    expect(clear).toMatchObject({ glyph: "shipDebris", tone: "good", name: "Debris field", outcome: "Steered clear", pauseText: null });
    expect(hit).toMatchObject({ glyph: "shipDebris", tone: "bad", outcome: "Hit", pauseText: "Scan paused 2m" });
    expect(hit.sentence).toContain("light hull damage (12 points)");
    expect(hit.sentence).toContain("2m");
  });

  it("a hostile probe won names its salvage; lost names the repair pause and the hull damage", () => {
    const run = shipRun(
      [
        { bodyIndex: 0, step: 1, kind: "shipEvent", event: "probe", outcome: "win", findingId: "f-1" },
        { bodyIndex: 0, step: 2, kind: "shipEvent", event: "probe", outcome: "loss", pauseSeconds: PROBE_REPAIR_SECONDS, hullWear: 18 },
      ],
      [{ id: "f-1", source: "encounter", materials: { commonOre: 3 }, credits: 20, relic: null }],
    );
    const [won, lost] = scanTrackView(run, 0)!.pips;
    expect(won).toMatchObject({ glyph: "shipProbe", tone: "good", outcome: "Won" });
    expect(won.sentence).toContain("Titanium Ore x3");
    expect(won.sentence).toContain("20 credits");
    expect(lost).toMatchObject({ tone: "bad", outcome: "Lost", pauseText: "Scan paused 5m" });
    expect(lost.sentence).toContain("the hull took 18 damage");
  });

  it("a sensor ghost read true promises one bonus discovery; a false reading costs a re-scan", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 1, kind: "shipEvent", event: "ghost", outcome: "pass", bonusDiscovery: true },
      { bodyIndex: 0, step: 2, kind: "shipEvent", event: "ghost", outcome: "fail", pauseSeconds: 180 },
    ]);
    const [truth, ghost] = scanTrackView(run, 0)!.pips;
    expect(truth).toMatchObject({ glyph: "sensorGhost", tone: "good", outcome: "Read true" });
    expect(truth.sentence).toContain("bonus discovery");
    expect(ghost).toMatchObject({ tone: "bad", outcome: "False reading", pauseText: "Scan paused 3m" });
  });

  it("a cloaked vessel and a radiation storm read with their own glyphs and words", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 1, kind: "shipEvent", event: "cloaked", outcome: "loss", pauseSeconds: 420, hullWear: 30 },
      { bodyIndex: 0, step: 2, kind: "shipEvent", event: "storm", outcome: "pass" },
      { bodyIndex: 0, step: 3, kind: "shipEvent", event: "storm", outcome: "fail", pauseSeconds: 240 },
    ]);
    const [cloaked, held, slowed] = scanTrackView(run, 0)!.pips;
    expect(cloaked).toMatchObject({ glyph: "cloakedVessel", name: "Cloaked vessel", outcome: "Lost", tone: "bad", pauseText: "Scan paused 7m" });
    expect(held).toMatchObject({ glyph: "radiationStorm", name: "Radiation storm", outcome: "Shields held", tone: "good" });
    expect(slowed).toMatchObject({ outcome: "Slowed", tone: "bad", pauseText: "Scan paused 4m" });
  });

  it("boarding: repelled keeps the event's glyph and says so; boarders aboard take the boarding glyph, the extra pause and the credits", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 1, kind: "shipEvent", event: "probe", outcome: "win", boarding: { repelled: true } },
      {
        bodyIndex: 0,
        step: 2,
        kind: "shipEvent",
        event: "probe",
        outcome: "loss",
        pauseSeconds: PROBE_REPAIR_SECONDS + BOARDING_PAUSE_SECONDS,
        hullWear: 18,
        boarding: { repelled: false, creditsLost: 40 },
      },
    ]);
    const [repelled, boarded] = scanTrackView(run, 0)!.pips;
    expect(repelled).toMatchObject({ glyph: "shipProbe", tone: "good", outcome: "Won, boarders repelled" });
    expect(repelled.sentence).toContain("repelled");
    expect(boarded).toMatchObject({ glyph: "boarding", tone: "bad", outcome: "Lost, boarded", pauseText: "Scan paused 10m" });
    expect(boarded.sentence).toContain("40 credits");
    expect(boarded.sentence).toContain("5m more");
  });

  it("a supply cache names what it held", () => {
    const run = shipRun([{ bodyIndex: 0, step: 5, kind: "supplyCache", findingId: "c-1" }], [{ id: "c-1", source: "supplyCache", materials: { commonOre: 2 }, credits: 15, relic: null }]);
    const [cache] = scanTrackView(run, 0)!.pips;
    expect(cache).toMatchObject({ glyph: "supplyCache", tone: "good", name: "Supply cache", outcome: "Found" });
    expect(cache.sentence).toBe("Supply cache: Titanium Ore x2, 15 credits.");
  });

  it("a legacy run keeps its ground battles: won with drops, lost with the pause and who was downed; each offers its battle log", () => {
    const run = legacyRun(
      [
        { bodyIndex: 0, step: 1, kind: "encounter", outcome: "win", downedMemberIds: [], findingId: "e-1" },
        { bodyIndex: 0, step: 2, kind: "encounter", outcome: "loss", downedMemberIds: ["m1", "m2"], pauseSeconds: 75 },
      ],
      [{ id: "e-1", source: "encounter", materials: { commonOre: 1 }, credits: 0, relic: null }],
    );
    const [won, lost] = scanTrackView(run, 0)!.pips;
    expect(won).toMatchObject({ glyph: "fightPoint", name: "Ground battle", outcome: "Won", tone: "good", battleLog: true });
    expect(won.sentence).toContain("Titanium Ore x1");
    expect(lost).toMatchObject({ outcome: "Lost", tone: "bad", pauseText: "Scan paused 1m 15s", battleLog: true });
    expect(lost.sentence).toContain("2 members downed");
    expect(scanTrackView(shipRun([{ bodyIndex: 0, step: 1, kind: "shipEvent", event: "probe", outcome: "win" }]), 0)!.pips[0].battleLog).toBe(false);
  });

  it("the text never relies on color: each pip's accessible name carries where, what and the outcome; no em dashes anywhere", () => {
    const run = shipRun([
      { bodyIndex: 0, step: 3, kind: "shipEvent", event: "debris", outcome: "fail", pauseSeconds: 120, hullWear: 4 },
      { bodyIndex: 0, step: 6, kind: "supplyCache", findingId: "missing" },
    ]);
    const v = scanTrackView(run, 0)!;
    expect(v.pips[0].atText).toBe("30%");
    expect(v.pips[0].ariaLabel).toBe(`At 30% of the scan: Debris field, Hit. ${v.pips[0].sentence}`);
    expect(v.pips[1].sentence).toBe("Supply cache: a small find."); // the finding is gone (never invents contents)
    expect(v.ariaLabel).toBe("Scan track: 50% scanned, 2 events.");
    for (const p of v.pips) for (const text of [p.sentence, p.ariaLabel, p.outcome, p.pauseText ?? ""]) expect(text).not.toMatch(NO_EM_DASH);
  });
});

describe("scanTrackKey: the key row", () => {
  it("lists only the kinds the run shows, in a fixed order, each with an SVG glyph that has a semantic class", () => {
    const run = shipRun([
      { bodyIndex: 1, step: 1, kind: "supplyCache" },
      { bodyIndex: 0, step: 1, kind: "shipEvent", event: "probe", outcome: "loss", boarding: { repelled: false } },
      { bodyIndex: 0, step: 2, kind: "shipEvent", event: "debris", outcome: "pass" },
    ]);
    const key = scanTrackKey(run);
    expect(key.entries.map((e) => e.text)).toEqual(["Debris field", "Supply cache", "Boarding"]);
    for (const e of key.entries) expect(ICON_SEMANTICS[e.glyph]).toBeDefined();
    expect(key.costNote).toBe("A dashed ring marks an event that cost something: scan time, hull, credits or injuries.");
  });

  it("has no cost note when nothing went wrong, and nothing at all on a quiet run", () => {
    expect(scanTrackKey(shipRun([{ bodyIndex: 0, step: 1, kind: "shipEvent", event: "storm", outcome: "pass" }])).costNote).toBeNull();
    expect(scanTrackKey(shipRun([])).entries).toEqual([]);
  });

  it("a legacy run's key reads Ground battle", () => {
    expect(scanTrackKey(legacyRun([{ bodyIndex: 0, step: 1, kind: "encounter", outcome: "win" }])).entries.map((e) => e.text)).toEqual(["Ground battle"]);
  });
});
