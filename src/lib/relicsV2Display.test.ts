// Relics v2 R2-7 / R2-8: the view models the Identification tab, the Cultures tab, the Museum v2 page and the Warehouse's
// Unidentified Relics row draw (relicsV2Display.ts). Every number is the engine's own, so these pin the wiring to it.
import { describe, it, expect } from "vitest";
import { freshState, type GameState, type RelicVaultToken } from "./game/model";
import { CULTURE_STUDY_POINTS, RELIC_SOFT_CAP, cultureCode, museumDepositGeneral, relicSampleCode } from "./game/relics";
import { queueAllRelicStudies, relicStudyDurationFor, resolveProcesses } from "./game/tick";
import {
  blankTitle,
  buildRelicRevealV2,
  cultureDetail,
  cultureRows,
  exceptionalSetViews,
  identificationLanes,
  identificationQueue,
  minutesText,
  museumTierView,
  recentIdentifications,
  vaultMatrix,
} from "./relicsV2Display";

const tok = (id: string, extra: Partial<RelicVaultToken> = {}): RelicVaultToken => ({ id, tier: "standard", quality: 0, ...extra });
const lab = (s: GameState, level: number): GameState => ({ ...s, facilities: { ...s.facilities, research: { level } } });

describe("the Warehouse's Unidentified Relics matrix", () => {
  it("counts every blank by region tier and rarity band, Tier I first, only tiers that hold one", () => {
    const m = vaultMatrix([tok("a"), tok("b", { tier: "radiant", regionTier: 3 }), tok("c", { tier: "augmented", regionTier: 3 }), tok("d", { regionTier: 1 })]);
    expect(m.total).toBe(4);
    expect(m.rows.map((r) => [r.tier, r.counts, r.total])).toEqual([
      [1, { standard: 2, augmented: 0, stellar: 0, radiant: 0 }, 2],
      [3, { standard: 0, augmented: 1, stellar: 0, radiant: 1 }, 2],
    ]);
    expect(m.bandTotals).toEqual({ standard: 2, augmented: 1, stellar: 0, radiant: 1 });
    expect(blankTitle(tok("x", { tier: "stellar", regionTier: 2 }))).toBe("Tier II · stellar blank");
  });
});

describe("the Identification tab", () => {
  it("lanes: busy, free and locked with the Lab tier that opens each (Lab I 1, III 2, V 3, VII 4)", () => {
    const s = queueAllRelicStudies({ ...lab(freshState(), 3), relicVault: [tok("a", { regionTier: 2 })] }).next;
    const lanes = identificationLanes(s);
    expect(lanes.map((l) => l.kind)).toEqual(["busy", "free", "locked", "locked"]);
    expect(lanes[0].title).toBe("Tier II · standard blank");
    expect(lanes.slice(2).map((l) => l.opensAt)).toEqual(["Research Lab V", "Research Lab VII"]);
    expect(identificationLanes(lab(freshState(), 0)).every((l) => l.kind === "locked")).toBe(true);
  });

  it("the queue in order with the engine's own durations; stale ids skipped", () => {
    const vault = [tok("a"), tok("b", { tier: "radiant" }), tok("c")];
    const s = queueAllRelicStudies({ ...lab(freshState(), 1), relicVault: vault }).next;
    const q = identificationQueue({ ...s, relicQueue: [...(s.relicQueue ?? []), "gone"] });
    expect(q.map((r) => r.token.id)).toEqual(["b", "c"]);
    expect(q[0].durationTicks).toBe(relicStudyDurationFor(s, s.museumV2, vault[1]));
    expect(minutesText(600)).toBe("10 min");
    expect(minutesText(95 * 60)).toBe("1 h 35 min");
  });
});

describe("the reveal card", () => {
  it("a general type: its tier, its sample name until the culture is named, the culture's study, the name reveal", () => {
    const culture = "culture-t1-1";
    const token = tok("r1", { regionTier: 1, cultureId: culture });
    let s: GameState = freshState();
    s = { ...s, museumV2: { ...s.museumV2, cultures: { [culture]: { points: 4, finds: { glyphTablet: 4 } } } } };
    const r = buildRelicRevealV2(s, { id: "done-1", subjectKey: "glyphTablet" }, false, token, new Set())!;
    expect(r.kind).toBe("general");
    expect(r.subtitle).toBe(`Tier I · standard · reads as Relic Sample ${relicSampleCode(culture, "glyphTablet")}`);
    expect(r.effect).toBe("Adds a Tier I copy: research speed.");
    expect(r.progress).toBe(`Culture ${cultureCode(culture)} study 4 / ${CULTURE_STUDY_POINTS}.`);
    const named: GameState = { ...s, museumV2: { ...s.museumV2, culturesNamed: [culture], cultures: { [culture]: { points: 10, finds: { glyphTablet: 10 } } } } };
    const r2 = buildRelicRevealV2(named, { id: "done-2", subjectKey: "glyphTablet" }, false, token, new Set())!;
    expect(r2.cultureRevealed).toBe("the Halvessi");
    expect(r2.subtitle).toBe("Tier I · standard · Halvessi Glyph Tablet");
    expect(buildRelicRevealV2(named, { id: "done-3", subjectKey: "glyphTablet" }, false, token, new Set([culture]))!.cultureRevealed).toBeNull();
  });

  it("an exceptional piece: named on reveal, its value, its set's progress; a duplicate says so", () => {
    const s0 = freshState();
    const s: GameState = { ...s0, museumV2: { ...s0.museumV2, exceptional: { "exc-t1-a-p1": 1 } } };
    const r = buildRelicRevealV2(s, { id: "done-1", subjectKey: "exc-t1-a-p1" }, true, null, new Set())!;
    expect([r.kind, r.title, r.effect, r.progress]).toEqual(["exceptional", "Waystation Lantern", "+3.0% research speed while held.", "Waystation Set now 1 of 2."]);
    const dup: GameState = { ...s0, museumV2: { ...s0.museumV2, exceptional: { "exc-t1-a-p1": 2, "exc-t1-a-p2": 1 }, setsCompleted: ["exc-t1-a"] } };
    const d = buildRelicRevealV2(dup, { id: "done-2", subjectKey: "exc-t1-a-p1" }, false, null, new Set())!;
    expect(d.effect).toBe("A duplicate: it counts toward Tier I's total and adds no bonus.");
    expect(d.progress).toBe("Waystation Set complete: 2 of 2, full set +15.0% research speed.");
    expect(buildRelicRevealV2(s, { id: "x", subjectKey: "nope" }, false, null, new Set())).toBeNull();
  });

  it("recent identifications read the completed-events record, newest first", () => {
    const s = queueAllRelicStudies({ ...lab(freshState(), 1), relicVault: [tok("a"), tok("b")] }).next;
    const done = resolveProcesses(s, 3600, () => 0).next;
    const recent = recentIdentifications(done);
    expect(recent.length).toBe(2);
    expect(recent[0].recordId > recent[1].recordId || recent[0].recordId.length > recent[1].recordId.length).toBe(true);
  });
});

describe("the Museum v2 page and the Cultures tab", () => {
  it("a tier's cap meter, its shelves by band with culture samples, and its bonuses from what the engine reads", () => {
    let s = freshState();
    let m = s.museumV2;
    m = museumDepositGeneral(m, 2, "flightRecorder", 3);
    m = { ...m, cultures: { "culture-t2-1": { points: 3, finds: { flightRecorder: 3 } } } };
    s = { ...s, museumV2: m };
    const v = museumTierView(s, 2);
    expect([v.total, v.frozen, v.untilCap]).toEqual([3, false, RELIC_SOFT_CAP - 3]);
    const fr = v.bands.find((b) => b.band === "augmented")!.types.find((t) => t.id === "flightRecorder")!;
    expect(fr.count).toBe(3);
    expect(fr.samples).toEqual([{ cultureId: "culture-t2-1", name: `Relic Sample ${relicSampleCode("culture-t2-1", "flightRecorder")}`, cultureName: `Culture ${cultureCode("culture-t2-1")}`, count: 3 }]);
    expect(v.bonuses.length).toBe(1);
    expect(v.bonuses[0]).toMatch(/transit speed$/);
    // A type whose first tier is above this one says where it turns up.
    expect(museumTierView(s, 1).bands.find((b) => b.band === "radiant")!.types.find((t) => t.id === "heartOfTheArchive")!.opensAt).toBe(7);
  });

  it("past the cap the meter shows the extra count and the snapshot", () => {
    const s = freshState();
    const m = museumDepositGeneral(s.museumV2, 3, "starChartFragment", RELIC_SOFT_CAP + 50);
    const v = museumTierView({ ...s, museumV2: m }, 3);
    expect([v.total, v.frozen, v.pastCap]).toEqual([RELIC_SOFT_CAP + 50, true, 50]);
    expect(v.overPct).toBeGreaterThan(0);
  });

  it("exceptional set cards: a piece is named once held; the full set shows active once complete", () => {
    const s0 = freshState();
    const s: GameState = { ...s0, museumV2: { ...s0.museumV2, exceptional: { "exc-t2-a-p2": 1 } } };
    const [set] = exceptionalSetViews(s, 2);
    expect(set.label).toBe("Hearthward Set");
    expect(set.pieces.map((p) => p.label)).toEqual([null, "Hearthward Kettle", null]);
    expect([set.held, set.size, set.complete]).toEqual([1, 3, false]);
  });

  it("cultures: listed once met, in roster order, with the detail's study split and finds", () => {
    const s0 = freshState();
    const s: GameState = { ...s0, museumV2: { ...s0.museumV2, cultures: { "culture-t2-3": { points: 5, finds: { flightRecorder: 3 } }, "culture-t1-6": { points: 1, finds: {} } } } };
    expect(cultureRows(s).map((r) => r.id)).toEqual(["culture-t1-6", "culture-t2-3"]);
    const d = cultureDetail(s, "culture-t2-3");
    expect([d.fromFinds, d.fromData, d.toGo, d.named, d.lore]).toEqual([3, 2, CULTURE_STUDY_POINTS - 5, false, null]);
    const named = cultureDetail({ ...s, museumV2: { ...s.museumV2, culturesNamed: ["culture-t2-3"] } }, "culture-t2-3");
    expect([named.title, named.lore]).toEqual(["Garrowin", "Builders of small, sturdy ships. Some of their hulls are still airtight."]);
    expect(named.finds[0].name).toBe("Garrowin Flight Recorder");
  });

  it("source planets (user 2026-11-13 \"First + count\"): the row's line and the detail's full list", () => {
    const s0 = freshState();
    const s: GameState = {
      ...s0,
      museumV2: {
        ...s0.museumV2,
        cultures: {
          "culture-t2-3": { points: 3, finds: { flightRecorder: 3 }, planets: ["OA-0201 d", "OA-0099 c", "OA-0150 b"] },
          "culture-t2-4": { points: 1, finds: { flightRecorder: 1 }, planets: ["OA-0300 b"] },
          "culture-t2-5": { points: 1, finds: {} },
        },
      },
    };
    expect(cultureRows(s).map((r) => r.foundOn)).toEqual(["Found on OA-0201 d and 2 more", "Found on OA-0300 b", ""]);
    expect(cultureDetail(s, "culture-t2-3").planets).toEqual(["OA-0201 d", "OA-0099 c", "OA-0150 b"]);
    expect(cultureDetail(s, "culture-t2-5").planets).toEqual([]);
  });
});
