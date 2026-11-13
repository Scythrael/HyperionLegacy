// Relics v2 R2-5 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-5): exceptional set completion and the minimal
// notable-event ledger. Plan tests: completion fires once per set; replaying a save does not duplicate; duplicates follow
// OC-7; the ledger survives a save round trip; plus the ledger's game second is the same for one call, 997 s chunks and
// 1 s steps (economyTick).
import { describe, it, expect } from "vitest";
import { freshState, type GameState, type NotableEvent, type RelicVaultToken } from "./model";
import { EXCEPTIONAL_SETS } from "./relics";
import { applyRelicIdentification, withSetCompletion } from "./relicIdentify";
import { economyTick, queueAllRelicStudies } from "./tick";
import { contentGoldenStart } from "./relicsV2Content.fixture";
import { relicSetCompletedEvents, withNotableEvents, withNotableEventsOnLoad } from "./notableEvents";
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
