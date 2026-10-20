import { describe, it, expect } from "vitest";
import { freshState, generalMuseumRecord, withGeneralMuseumRecord, type CompletionLogEntry, type GameState, type RelicVaultToken, type RelicSetId } from "./game/model";
import { RELIC_SETS, getRelicById } from "./game/relics";
import { startRelicStudy, resolveProcesses, identifyStudiedRelic } from "./game/tick";
import { buildRelicReveal, pickRelicStudyRecord, unseenRelicStudyRecords } from "./relicReveal";

// Exploration 0.14.0 (E4c): the identification-reveal OBSERVER's decision surface. App.svelte watches a
// relicStudy process enter and leave; these pure helpers decide which completion RECORD belongs to it
// (never an inventory diff) and build the reveal card from it.

function token(id: string, setId: RelicSetId, tier: RelicVaultToken["tier"] = "standard"): RelicVaultToken {
  const poiId = RELIC_SETS.find((s) => s.id === setId)!.sources[0];
  return { id, tier, quality: 0, setId, poiId };
}

function record(id: string, subjectKey: string | null, over: Partial<CompletionLogEntry> = {}): CompletionLogEntry {
  return {
    id,
    kind: "relicStudy",
    reward: "relic",
    atMs: 0,
    startedAtMs: 0,
    iterations: 1,
    items: [],
    pieces: 1,
    subjectKey,
    level: null,
    fuelAmount: null,
    creditsAmount: null,
    stale: false,
    ...over,
  };
}

describe("unseenRelicStudyRecords", () => {
  it("keeps only relicStudy relic records the study had not already seen, oldest first", () => {
    const log = [
      record("done-1", "glyphTablet"),
      record("done-2", "hullRivet", { kind: "salvageJob", reward: "materials" }),
      record("done-3", "geodeCore"),
      record("done-4", "magmaPearl"),
      record("done-5", null, { reward: "nothing" }),
    ];
    const unseen = unseenRelicStudyRecords(log, new Set(["done-1"]));
    expect(unseen.map((e) => e.id)).toEqual(["done-3", "done-4"]);
  });
});

describe("pickRelicStudyRecord", () => {
  const unseen = [record("done-3", "geodeCore"), record("done-4", "magmaPearl")];

  it("takes the record naming the relic the engine derives for that study", () => {
    expect(pickRelicStudyRecord(unseen, "magmaPearl")?.id).toBe("done-4");
  });

  it("is STRICT when it knows the expected relic: an unrelated record is never borrowed", () => {
    expect(pickRelicStudyRecord(unseen, "tectonicKeystone")).toBeNull();
  });

  it("falls back to the oldest unseen record only when there is no expectation", () => {
    expect(pickRelicStudyRecord(unseen, null)?.id).toBe("done-3");
    expect(pickRelicStudyRecord([], null)).toBeNull();
  });
});

describe("buildRelicReveal", () => {
  it("reads the identified relic's catalog entry + the museum as it now stands", () => {
    const s: GameState = withGeneralMuseumRecord(freshState(), { hullRivet: 4, flightRecorder: 2, ancientDriveCoil: 1 });
    const r = buildRelicReveal(s, record("done-9", "ancientDriveCoil"), true, "radiant")!;
    expect(r).toMatchObject({
      recordId: "done-9",
      relicId: "ancientDriveCoil",
      relicLabel: "Ancient Drive Coil",
      rarity: "rare",
      setId: "shipwright",
      setLabel: "Shipwright Set",
      index: 3,
      setSize: 4,
      tokenTier: "radiant",
      firstFind: true,
      copyNumber: 1,
      setCollected: 3,
    });
    expect(r.flavor).toBe(getRelicById("ancientDriveCoil")!.flavor);
  });

  it("returns null for a record naming an unknown relic (a tampered save)", () => {
    expect(buildRelicReveal(freshState(), record("done-1", "notARelic"), false, null)).toBeNull();
    expect(buildRelicReveal(freshState(), record("done-1", null), false, null)).toBeNull();
  });

  it("end to end: a real study's completion record is the one the observer picks, and it names the museum copy", () => {
    const s: GameState = { ...freshState(), relicVault: [token("t1", "xenobiology", "stellar")] };
    const seen = new Set((s.completionLog ?? []).map((e) => e.id));
    const started = startRelicStudy(s, "t1");
    expect(started.started).toBe(true);
    const proc = started.next.activeProcesses.find((p) => p.kind === "relicStudy")!;
    const after = resolveProcesses(started.next, proc.remainingTicks, () => 0).next;
    const expected = proc.effect.type === "identifyRelic" ? identifyStudiedRelic(after, proc.effect.token, proc.effect.studyIndex) : null;
    const rec = pickRelicStudyRecord(unseenRelicStudyRecords(after.completionLog, seen), expected)!;
    expect(rec).not.toBeNull();
    const reveal = buildRelicReveal(after, rec, !s.relicDiscovered.includes(rec.subjectKey!), "stellar")!;
    expect(reveal.setId).toBe("xenobiology");
    expect(generalMuseumRecord(after)[reveal.relicId]).toBe(1);
    expect(reveal.copyNumber).toBe(1);
    expect(reveal.firstFind).toBe(true);
    expect(after.relicDiscovered).toContain(reveal.relicId);
  });
});
