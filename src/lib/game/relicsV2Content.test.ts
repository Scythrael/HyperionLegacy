// Relics v2 R2-5 and R2-6 (docs/plans/2026-10-17-relics-v2-plan.md section 4). R2-5: exceptional set completion and the
// minimal notable-event ledger (completion fires once per set; replaying a save does not duplicate; duplicates follow
// OC-7; the ledger survives a save round trip; its game second is the same for one call, 997 s chunks and 1 s steps).
// R2-6: cultures (naming is a pure function of stored state; the threshold is exact; renames apply to old finds; no
// culture name is a reserved antagonist label; the names are the approved sheet's).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { freshState, type GameState, type NotableEvent, type RelicVaultToken } from "./model";
import {
  CULTURE_CODES,
  CULTURE_CONTENT,
  CULTURE_ROSTER,
  CULTURE_STUDY_POINTS,
  EXCEPTIONAL_SETS,
  RELIC_SETS,
  RELIC_TYPES,
  cultureCode,
  cultureListName,
  cultureProseName,
  generalRelicSampleName,
  relicSampleCode,
  withCultureRevealsOnLoad,
  withCulturePlanet,
  culturePlanetsText,
} from "./relics";
import { feedCultureData } from "./dataStudy";
import { applyRelicIdentification, withSetCompletion } from "./relicIdentify";
import { economyTick, queueAllRelicStudies } from "./tick";
import { contentGoldenStart } from "./relicsV2Content.fixture";
import { relicSetCompletedEvents, withNotableEvents, withNotableEventsOnLoad } from "./notableEvents";
import { NOTABLE_EVENT_KINDS } from "./model";
import { relicBlankStamp, relicPlanetName } from "./relicBlanks";
import { deserialize, migrate, serialize, type SaveFile } from "./save";

// Twelve radiant Tier VII blanks on relic seed 2 (Lab VII, every set held but its last piece): one exceptional reveal,
// which completes a set (seed found by search, pinned by the first test below).
function ledgerStart(): GameState {
  const base = contentGoldenStart(0);
  const vault: RelicVaultToken[] = Array.from({ length: 12 }, (_, n) => ({ id: `led-${n}`, tier: "radiant", quality: 0, regionTier: 7, cultureId: "culture-t7-1", source: "expedition" }));
  return queueAllRelicStudies({ ...base, relicVault: vault, relicSeed: 2 }).next;
}
const CHAIN_TICKS = 12 * 1800; // three rounds of four 30 minute studies, with room to spare
const studying = (s: GameState) => s.activeProcesses.some((p) => p.kind === "relicStudy") || (s.relicQueue ?? []).length > 0;

describe("R2-5: a set completion writes one ledger event at its game second", () => {
  it("one call, 997 s chunks and 1 s steps land the same ledger, Museum and state", () => {
    const one = economyTick(ledgerStart(), CHAIN_TICKS, () => 0);
    expect(studying(one)).toBe(false);
    expect(one.notableEvents?.length).toBe(1);
    const ev = one.notableEvents![0];
    expect(ev.kind).toBe("relicSetCompleted");
    expect(one.museumV2.setsCompleted).toEqual([ev.setId]);
    expect(ev.tier).toBe(7);
    // The stamp is a game second inside the window, after the start.
    expect(ev.atGameSeconds).toBeGreaterThan(ledgerStart().gameTimeSeconds);
    expect(ev.atGameSeconds).toBeLessThanOrEqual(one.gameTimeSeconds);

    let chunks = ledgerStart();
    for (let left = CHAIN_TICKS; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), () => 0);
    let steps = ledgerStart();
    for (let i = 0; i < CHAIN_TICKS; i++) steps = economyTick(steps, 1, () => 0);
    for (const other of [chunks, steps]) {
      expect(other.notableEvents).toEqual(one.notableEvents);
      expect(other.museumV2).toEqual(one.museumV2);
      expect(other.relicDiscovered).toEqual(one.relicDiscovered);
      expect(other.gameTimeSeconds).toBe(one.gameTimeSeconds);
    }
  });

  it("completion fires once per set: a duplicate piece of a complete set adds no event and no list entry (OC-7)", () => {
    const set = EXCEPTIONAL_SETS.find((s) => s.id === "exc-t2-a")!;
    let m = freshState().museumV2;
    let discovered: string[] = [];
    const piece = (id: string) => ({ kind: "exceptional" as const, tier: 2 as const, pieceId: id, setId: set.id, duplicate: false });
    const lists: string[][] = [];
    for (const p of [...set.pieces, set.pieces[0], set.pieces[2]]) {
      ({ museum: m, discovered } = applyRelicIdentification(m, discovered, piece(p.id), null));
      lists.push([...m.setsCompleted]);
    }
    expect(lists).toEqual([[], [], ["exc-t2-a"], ["exc-t2-a"], ["exc-t2-a"]]);
    expect(m.exceptional[set.pieces[0].id]).toBe(2);
    // withSetCompletion is the same reference once listed, and before every piece is held.
    expect(withSetCompletion(m, set.id)).toBe(m);
    const partial = { ...freshState().museumV2, exceptional: { [set.pieces[0].id]: 1 } };
    expect(withSetCompletion(partial, set.id)).toBe(partial);
    expect(relicSetCompletedEvents(["exc-t2-a"], ["exc-t2-a"], 5)).toEqual([]);
  });

  it("the ledger is append-only and idempotent by key", () => {
    const a: NotableEvent = { key: "relicSetCompleted:exc-t1-a", kind: "relicSetCompleted", atGameSeconds: 10, setId: "exc-t1-a", tier: 1 };
    const b: NotableEvent = { ...a, key: "relicSetCompleted:exc-t2-a", setId: "exc-t2-a", tier: 2, atGameSeconds: 20 };
    const once = withNotableEvents(undefined, [a]);
    expect(once).toEqual([a]);
    expect(withNotableEvents(once, [{ ...a, atGameSeconds: 99 }])).toBe(once);
    expect(withNotableEvents(once, [b, b])).toEqual([a, b]);
    expect(withNotableEvents(once, [])).toBe(once);
  });

  it("replaying a save (save, load, keep playing) never duplicates an event, and the ledger round-trips", () => {
    const done = economyTick(ledgerStart(), CHAIN_TICKS, () => 0);
    const loaded = migrate(deserialize(serialize(done, 0)) as SaveFile, 1);
    expect(loaded.notableEvents).toEqual(done.notableEvents);
    // Feed the same blanks again: a second reveal of the completed set's pieces is a duplicate (no new event).
    const again = economyTick(queueAllRelicStudies({ ...loaded, relicVault: ledgerStart().relicVault }).next, CHAIN_TICKS, () => 0);
    const keys = (again.notableEvents ?? []).map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === done.notableEvents![0].key).length).toBe(1);
  });

  it("load hygiene: a malformed ledger is dropped, bad or repeated entries left out, a clean one kept as is", () => {
    const good: NotableEvent = { key: "relicSetCompleted:exc-t1-a", kind: "relicSetCompleted", atGameSeconds: 3, setId: "exc-t1-a", tier: 1 };
    const clean = { ...freshState(), notableEvents: [good] };
    expect(withNotableEventsOnLoad(clean)).toBe(clean);
    expect("notableEvents" in withNotableEventsOnLoad({ ...freshState(), notableEvents: "x" })).toBe(false);
    expect(withNotableEventsOnLoad({ ...freshState(), notableEvents: [good, good, { key: 1 }, { ...good, key: "k2", tier: 9 }] }).notableEvents).toEqual([good]);
    const none = freshState();
    expect(withNotableEventsOnLoad(none)).toBe(none);
  });
});

describe("R2-6: cultures", () => {
  it("the 42 names and lore lines are the approved sheet's (Part B), one per roster id", () => {
    const sheet = readFileSync("docs/plans/2026-11-02-relic-name-sheets-DRAFT.md", "utf8").split("\r").join("");
    const partB = sheet.slice(sheet.indexOf("## Part B"), sheet.indexOf("## USER ANSWERS (2026-11-02)"));
    const rows: Record<string, { name: string; lore: string }> = {};
    for (const m of partB.matchAll(/^\| (culture-t\d-\d) \| ([^|]+) \| (.+) \|$/gm)) rows[m[1]] = { name: m[2].trim(), lore: m[3].trim() };
    expect(Object.keys(rows).length).toBe(42);
    expect(CULTURE_CONTENT).toEqual(rows);
    expect(Object.values(CULTURE_ROSTER).flat().sort()).toEqual(Object.keys(rows).sort());
  });

  it("no culture name is a reserved antagonist label or an existing relic word, and every name is unique", () => {
    // The First Cause antagonists (placeholder DBDs) are never named in game and no culture is ever them; "Precursor"
    // is the umbrella word over every culture (call 11), never one culture's name.
    const reserved = ["first cause", "dbd", "precursor"];
    const owned = [...RELIC_TYPES.map((t) => t.label), ...RELIC_SETS.map((s) => s.label), ...EXCEPTIONAL_SETS.flatMap((s) => [s.label, ...s.pieces.map((p) => p.label)])].map((x) => x.toLowerCase());
    const names = Object.values(CULTURE_CONTENT).map((c) => c.name);
    expect(new Set(names).size).toBe(42);
    for (const n of names) {
      for (const r of reserved) expect(n.toLowerCase()).not.toContain(r);
      expect(owned).not.toContain(n.toLowerCase());
      for (const text of [n, CULTURE_CONTENT[Object.keys(CULTURE_CONTENT).find((k) => CULTURE_CONTENT[k].name === n)!].lore]) expect(text).not.toMatch(/—|--/);
    }
  });

  it("codes are derived, unique and stable; a sample code is derived from the culture and the type", () => {
    const codes = Object.values(CULTURE_CODES);
    expect(codes.length).toBe(42);
    expect(new Set(codes).size).toBe(42);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z]-[1-9]\d$/);
    expect(cultureCode("culture-t1-1")).toBe(CULTURE_CODES["culture-t1-1"]);
    expect(relicSampleCode("culture-t1-1", "glyphTablet")).toMatch(new RegExp(`^${CULTURE_CODES["culture-t1-1"].replace("-", "")}-\\d\\d$`));
    expect(relicSampleCode("culture-t1-1", "glyphTablet")).toBe(relicSampleCode("culture-t1-1", "glyphTablet"));
    expect(relicSampleCode("culture-t1-1", "glyphTablet")).not.toBe(relicSampleCode("culture-t1-1", "geodeCore"));
  });

  it("the threshold is exact: nine points name nothing, the tenth names the culture once; renames apply to old finds", () => {
    const id = "culture-t1-1";
    let m = freshState().museumV2;
    const before = generalRelicSampleName(m, id, "glyphTablet");
    expect(before).toBe(`Relic Sample ${relicSampleCode(id, "glyphTablet")}`);
    for (let i = 0; i < CULTURE_STUDY_POINTS - 1; i++) m = feedCultureData(m, id, 1);
    expect(m.culturesNamed).toEqual([]);
    expect(cultureListName(m, id)).toBe(`Culture ${cultureCode(id)}`);
    expect(cultureProseName(m, id)).toBe(`Culture ${cultureCode(id)}`);
    m = feedCultureData(m, id, 1);
    expect(m.culturesNamed).toEqual([id]);
    m = feedCultureData(m, id, 5);
    expect(m.culturesNamed).toEqual([id]);
    // Display reads only the stored list (a pure function of stored state), and an old find now reads with the name.
    expect(cultureListName(m, id)).toBe("Halvessi");
    expect(cultureProseName(m, id)).toBe("the Halvessi");
    expect(generalRelicSampleName(m, id, "glyphTablet")).toBe("Halvessi Glyph Tablet");
    expect(cultureListName({ culturesNamed: [id] }, id)).toBe("Halvessi");
  });

  it("identification points reveal at ten too, and one call equals 997 tick chunks for the named list", () => {
    const vault: RelicVaultToken[] = Array.from({ length: 12 }, (_, n) => ({ id: `cul-${n}`, tier: "standard", quality: 0, regionTier: 1, cultureId: "culture-t1-3", source: "expedition" }));
    const start = queueAllRelicStudies({ ...contentGoldenStart(0), relicVault: vault }).next;
    const one = economyTick(start, 12 * 900, () => 0);
    let chunks = start;
    for (let left = 12 * 900; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), () => 0);
    expect(one.museumV2.cultures["culture-t1-3"].points).toBeGreaterThanOrEqual(CULTURE_STUDY_POINTS);
    expect(one.museumV2.culturesNamed).toEqual(["culture-t1-3"]);
    expect(chunks.museumV2).toEqual(one.museumV2);
  });

  it("offline == live: an ancient data study and a relic find naming two cultures in one window list them the same (one call == 997 s chunks == 1 s steps)", () => {
    // The fragment of culture-t1-4 completes first (60 s), the relic of culture-t1-1 later (600 s); a resolve applies the
    // data feed after the relic chain, so reveal order would differ between one call and 1 s steps. The list is canonical
    // (roster order), so every chunking lands the same bytes.
    const base = contentGoldenStart(0);
    const blank: RelicVaultToken = { id: "par-1", tier: "standard", quality: 0, regionTier: 1, cultureId: "culture-t1-1", source: "expedition" };
    const start: GameState = queueAllRelicStudies({
      ...base,
      museumV2: { ...base.museumV2, cultures: { "culture-t1-1": { points: 9, finds: { glyphTablet: 9 } }, "culture-t1-4": { points: 9, finds: {} } } },
      relicVault: [blank],
      activeProcesses: [
        ...base.activeProcesses,
        { id: "proc-9000", kind: "dataStudy", remainingTicks: 60, durationTicks: 60, effect: { type: "studyData", itemId: "ancientDataFragment", studyIndex: 1, cultureId: "culture-t1-4" } },
      ],
    }).next;
    const TICKS = 1200;
    const one = economyTick(start, TICKS, () => 0);
    let chunks = start;
    for (let left = TICKS; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), () => 0);
    let steps = start;
    for (let i = 0; i < TICKS; i++) steps = economyTick(steps, 1, () => 0);
    expect(one.museumV2.culturesNamed).toEqual(["culture-t1-1", "culture-t1-4"]);
    for (const other of [chunks, steps]) {
      expect(JSON.stringify(other.museumV2)).toBe(JSON.stringify(one.museumV2));
      expect(other.ancientDecoded).toEqual(one.ancientDecoded);
    }
  });

  it("the named list is kept in roster order whatever order the reveals come in; load puts an old list in order", () => {
    let m = freshState().museumV2;
    for (const id of ["culture-t3-2", "culture-t1-5", "culture-t2-1"]) for (let i = 0; i < CULTURE_STUDY_POINTS; i++) m = feedCultureData(m, id, 1);
    expect(m.culturesNamed).toEqual(["culture-t1-5", "culture-t2-1", "culture-t3-2"]);
    const old = { ...freshState(), museumV2: { ...m, culturesNamed: ["culture-t3-2", "culture-t1-5", "culture-t2-1"] } };
    expect(withCultureRevealsOnLoad(old).museumV2.culturesNamed).toEqual(["culture-t1-5", "culture-t2-1", "culture-t3-2"]);
  });

  it("load: a culture already at the threshold is named (roster order); a clean save is the same reference", () => {
    const base = freshState();
    const s = { ...base, museumV2: { ...base.museumV2, cultures: { "culture-t2-1": { points: 11, finds: {} }, "culture-t1-4": { points: 10, finds: {} }, "culture-t1-1": { points: 3, finds: {} } } } };
    expect(withCultureRevealsOnLoad(s).museumV2.culturesNamed).toEqual(["culture-t1-4", "culture-t2-1"]);
    const named = withCultureRevealsOnLoad(s);
    expect(withCultureRevealsOnLoad(named)).toBe(named);
    expect(withCultureRevealsOnLoad(base)).toBe(base);
    const loaded = migrate(deserialize(serialize(s as GameState, 0)) as SaveFile, 1);
    expect(loaded.museumV2.culturesNamed).toEqual(["culture-t1-4", "culture-t2-1"]);
  });
});

describe('a culture\'s source planets (user 2026-11-13 "First + count")', () => {
  it("each planet once: the first found first, the rest in canonical order; the row text", () => {
    let r: { points: number; finds: Record<string, number>; planets?: string[] } = { points: 0, finds: {} };
    expect(culturePlanetsText(r.planets)).toBe("");
    for (const p of ["OA-0201 d", "OA-0201 b", "OA-0099 c", "OA-0201 b", "OA-0150 b"]) r = withCulturePlanet(r, p);
    expect(r.planets).toEqual(["OA-0201 d", "OA-0099 c", "OA-0150 b", "OA-0201 b"]);
    expect(withCulturePlanet(r, "OA-0099 c")).toBe(r);
    expect(culturePlanetsText(["LB-0412 c"])).toBe("Found on LB-0412 c");
    expect(culturePlanetsText(r.planets)).toBe("Found on OA-0201 d and 3 more");
  });

  it("a run with the blanks flag stamps its body's name on every blank (display only)", () => {
    const run = { seed: 7, region: { tier: 2 }, risk: undefined, relicBlanks: { version: 1, stagger: 1 }, systemName: "OA-0201" } as unknown as Parameters<typeof relicBlankStamp>[0];
    expect(relicBlankStamp(run, 2)?.planet).toBe("OA-0201 d");
    expect(relicPlanetName({ systemName: "Wolf 359", region: undefined } as never, 0)).toBe("Wolf 359 1");
    expect(relicBlankStamp({ ...run, relicBlanks: undefined } as never, 2)).toBeUndefined();
  });

  it("identification records the planets, the same for one call, 997 s chunks and 1 s steps", () => {
    const planets = ["OA-0201 d", "OA-0099 c", "OA-0201 d", "OA-0150 b"];
    const vault: RelicVaultToken[] = planets.map((p, n) => ({ id: `pl-${n}`, tier: "standard", quality: 0, regionTier: 2, cultureId: "culture-t2-5", source: "expedition", planet: p }));
    const start = queueAllRelicStudies({ ...contentGoldenStart(0), relicVault: vault }).next;
    const T = 1500;
    const one = economyTick(start, T, () => 0);
    let chunks = start;
    for (let left = T; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), () => 0);
    let steps = start;
    for (let i = 0; i < T; i++) steps = economyTick(steps, 1, () => 0);
    const rec = one.museumV2.cultures["culture-t2-5"];
    expect(rec.points).toBe(4);
    expect(rec.planets?.[0]).toBe("OA-0201 d");
    expect([...(rec.planets ?? [])].sort()).toEqual(["OA-0099 c", "OA-0150 b", "OA-0201 d"]);
    for (const other of [chunks, steps]) expect(JSON.stringify(other.museumV2)).toBe(JSON.stringify(one.museumV2));
  });

  it("load keeps planet names only, each once; a clean record is the same reference", () => {
    const base = freshState();
    const clean = { ...base, museumV2: { ...base.museumV2, cultures: { "culture-t1-1": { points: 2, finds: {}, planets: ["LB-0001 b"] } } } };
    expect(withCultureRevealsOnLoad(clean)).toBe(clean);
    const dirty = { ...base, museumV2: { ...base.museumV2, cultures: { "culture-t1-1": { points: 2, finds: {}, planets: ["LB-0001 b", 7, "LB-0001 b"] } } } };
    expect(withCultureRevealsOnLoad(dirty).museumV2.cultures["culture-t1-1"].planets).toEqual(["LB-0001 b"]);
    const notList = { ...base, museumV2: { ...base.museumV2, cultures: { "culture-t1-1": { points: 2, finds: {}, planets: "x" } } } };
    expect("planets" in withCultureRevealsOnLoad(notList).museumV2.cultures["culture-t1-1"]).toBe(false);
  });
});

describe("the ledger keeps every known kind on load (NOTABLE_EVENT_KINDS)", () => {
  it("a kind added to the list survives a load; a kind not in it is dropped", () => {
    const set: NotableEvent = { key: "relicSetCompleted:exc-t1-a", kind: "relicSetCompleted", atGameSeconds: 3, setId: "exc-t1-a", tier: 1 };
    const other = { key: "systemCompleted:sys-1", kind: "systemCompleted", atGameSeconds: 9 };
    const s = { ...freshState(), notableEvents: [set, other] };
    expect(withNotableEventsOnLoad(s).notableEvents).toEqual([set]);
    const kinds = NOTABLE_EVENT_KINDS as unknown as string[];
    kinds.push("systemCompleted");
    try {
      expect(withNotableEventsOnLoad(s)).toBe(s);
    } finally {
      kinds.pop();
    }
    // A relicSetCompleted event still needs its set id and tier.
    expect(withNotableEventsOnLoad({ ...freshState(), notableEvents: [{ ...set, tier: undefined }] }).notableEvents).toEqual([]);
  });
});
