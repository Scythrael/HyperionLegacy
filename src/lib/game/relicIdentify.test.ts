// Relics v2 R2-3 (docs/plans/2026-10-17-relics-v2-plan.md section 4 R2-3): identification v2, lanes by Lab tier and the
// identification queue. Engine only.

import { describe, it, expect } from "vitest";
import { RELIC_DEFAULT_SEED, emptyMuseumV2, freshState, type GameState, type MuseumV2, type RegionTier, type RelicVaultToken, type TimedProcess } from "./model";
import { EXCEPTIONAL_PER_100K, RELIC_BAND_ODDS, RELIC_SETS, exceptionalSetsOfTier, getRelicTypeById, relicStudyDurationTicks } from "./relics";
import {
  RELIC_STUDY_LANES_BY_LAB,
  RELIC_STUDY_VERSION,
  applyRelicIdentification,
  identificationBandRow,
  identifyRelicV2,
  relicStudyLanesAt,
  relicStudyV2Seed,
  rollRelicIdentification,
} from "./relicIdentify";
import {
  canStartRelicStudy,
  economyTick,
  identifyStudiedRelic,
  moveRelicQueueEntry,
  pumpRelicQueue,
  queueAllRelicStudies,
  queueRelicStudy,
  relicStudiesInFlight,
  relicStudySlotCount,
  resolveProcesses,
  startRelicStudy,
  tick,
  unqueueRelicStudy,
} from "./tick";
import { deserialize, serialize } from "./save";
import { makeRng, type Rng } from "./combat/rng";
import { WIRING_REGISTRY } from "./wiring/registry";
import { R2_3_ADDED_ENTRY_IDS } from "./relicIdentify.fixture";

const withLab = (s: GameState, level: number): GameState => ({ ...s, facilities: { ...s.facilities, research: { level } } });

function blank(id: string, extra: Partial<RelicVaultToken> = {}): RelicVaultToken {
  return { id, tier: "standard", quality: 0, ...extra };
}
function sited(id: string, setId: (typeof RELIC_SETS)[number]["id"], extra: Partial<RelicVaultToken> = {}): RelicVaultToken {
  return blank(id, { setId, poiId: RELIC_SETS.find((s) => s.id === setId)!.sources[0], ...extra });
}

// An Rng that counts its integer draws and answers each with `answer(maxExclusive)`.
function scripted(answer: (max: number) => number): Rng & { draws: number } {
  const r = {
    draws: 0,
    next: () => 0,
    nextInt(max: number) {
      r.draws++;
      return answer(max);
    },
    nextRange: (a: number) => a,
    chance: () => false,
  };
  return r as unknown as Rng & { draws: number };
}

const TIER_I_PIECES = exceptionalSetsOfTier(1).flatMap((s) => s.pieces);

describe("R2-3 identification v2: the keyed roll", () => {
  it("draws exactly three integers on the general path and on the exceptional path", () => {
    const general = scripted((max) => max - 1); // the check misses (99,999 is never under the chance)
    const g = rollRelicIdentification(general, { regionTier: 1, rarity: "standard", siteSet: null, heldExceptional: {} });
    expect(g.kind).toBe("general");
    expect(general.draws).toBe(3);
    const exceptional = scripted(() => 0); // the check hits
    const e = rollRelicIdentification(exceptional, { regionTier: 1, rarity: "standard", siteSet: null, heldExceptional: {} });
    expect(e.kind).toBe("exceptional");
    expect(exceptional.draws).toBe(3);
  });

  it("the exceptional check is per 100,000 at the tier's EXCEPTIONAL_PER_100K", () => {
    for (const tier of [1, 4, 7] as RegionTier[]) {
      const chance = EXCEPTIONAL_PER_100K[tier].stellar;
      const at = (check: number) => rollRelicIdentification(scripted((max) => (max === 100_000 ? check : 0)), { regionTier: tier, rarity: "stellar", siteSet: null, heldExceptional: {} }).kind;
      expect(at(chance - 1)).toBe("exceptional");
      expect(at(chance)).toBe("general");
    }
  });

  it("is a pure function of its stored inputs; the token id and the study index are mixed in", () => {
    const t = blank("tok-a", { regionTier: 3, tier: "augmented" });
    expect(identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), t, 7)).toEqual(identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), t, 7));
    expect(relicStudyV2Seed(RELIC_DEFAULT_SEED, 7, "tok-a")).not.toBe(relicStudyV2Seed(RELIC_DEFAULT_SEED, 7, "tok-b"));
    expect(relicStudyV2Seed(RELIC_DEFAULT_SEED, 7, "tok-a")).not.toBe(relicStudyV2Seed(RELIC_DEFAULT_SEED, 8, "tok-a"));
  });

  it("\"Only one boost\": the band odds are the blank's own rarity row at every tier, so a general reveal never reads the tier", () => {
    for (const rarity of ["standard", "augmented", "stellar", "radiant"] as const) {
      expect(identificationBandRow(rarity)).toEqual(RELIC_BAND_ODDS[1][rarity]);
    }
    // Same seed, same blank rarity, Tier I against Tier VII: whenever both reveal a general relic it is the same type.
    let compared = 0;
    for (let i = 0; i < 2000; i++) {
      const at = (regionTier: RegionTier) => identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), blank(`t-${i}`, { regionTier, tier: "standard" }), i + 1);
      const a = at(1);
      const b = at(7);
      if (a.kind === "general" && b.kind === "general") {
        compared++;
        expect(b.typeId).toBe(a.typeId);
        expect(b.tier).toBe(7);
      }
    }
    expect(compared).toBeGreaterThan(1900);
  });

  it("the site bias doubles the source site's old set types", () => {
    let geode = 0;
    let standard = 0;
    for (let i = 0; i < 6000; i++) {
      const o = identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), sited(`s-${i}`, "deepEarth"), i + 1);
      if (o.kind !== "general" || getRelicTypeById(o.typeId)!.band !== "standard") continue;
      standard++;
      if (o.typeId === "geodeCore") geode++;
    }
    expect(Math.abs(geode / standard - 2 / 5)).toBeLessThan(0.03); // 4 standard types, Geode Core weighted 2
  });

  it("call 7: the reveal prefers the pieces the Museum lacks; with every piece held it is a duplicate", () => {
    const allButLast = Object.fromEntries(TIER_I_PIECES.slice(0, -1).map((p) => [p.id, 1]));
    const hit = () => scripted((max) => (max === 100_000 ? 0 : 0));
    const missing = rollRelicIdentification(hit(), { regionTier: 1, rarity: "standard", siteSet: null, heldExceptional: allButLast });
    expect(missing).toMatchObject({ kind: "exceptional", pieceId: TIER_I_PIECES[TIER_I_PIECES.length - 1].id, duplicate: false });
    const all = Object.fromEntries(TIER_I_PIECES.map((p) => [p.id, 1]));
    const dup = rollRelicIdentification(hit(), { regionTier: 1, rarity: "standard", siteSet: null, heldExceptional: all });
    expect(dup).toMatchObject({ kind: "exceptional", pieceId: TIER_I_PIECES[0].id, duplicate: true });
  });
});

describe("R2-3 identification v2: the deposit", () => {
  it("a general relic: one copy at its region tier, a culture point and find, its first find", () => {
    const m = applyRelicIdentification(emptyMuseumV2(), [], { kind: "general", tier: 3, typeId: "hullRivet" }, "culture-t3-2");
    expect(m.museum.general).toEqual({ "3": { hullRivet: 1 } });
    expect(m.museum.cultures).toEqual({ "culture-t3-2": { points: 1, finds: { hullRivet: 1 } } });
    expect(m.discovered).toEqual(["hullRivet"]);
    const again = applyRelicIdentification(m.museum, m.discovered, { kind: "general", tier: 3, typeId: "hullRivet" }, "culture-t3-2");
    expect(again.museum.general["3"]).toEqual({ hullRivet: 2 });
    expect(again.museum.cultures["culture-t3-2"]).toEqual({ points: 2, finds: { hullRivet: 2 } });
    expect(again.discovered).toEqual(["hullRivet"]);
  });

  it("an exceptional piece: one copy (duplicates counted), its first find, and its set completed once", () => {
    const [set] = exceptionalSetsOfTier(1);
    let museum: MuseumV2 = emptyMuseumV2();
    let discovered: string[] = [];
    for (const p of set.pieces) {
      ({ museum, discovered } = applyRelicIdentification(museum, discovered, { kind: "exceptional", tier: 1, pieceId: p.id, setId: set.id, duplicate: false }, null));
    }
    expect(museum.setsCompleted).toEqual([set.id]);
    expect(discovered).toEqual(set.pieces.map((p) => p.id));
    expect(museum.cultures).toEqual({}); // no culture point for an exceptional piece
    ({ museum, discovered } = applyRelicIdentification(museum, discovered, { kind: "exceptional", tier: 1, pieceId: set.pieces[0].id, setId: set.id, duplicate: true }, null));
    expect(museum.exceptional[set.pieces[0].id]).toBe(2);
    expect(museum.setsCompleted).toEqual([set.id]); // never twice
  });
});

describe("R2-3 lanes by Research Lab tier (call 12)", () => {
  it("Lab I 1, III 2, V 3, VII 4, no Lab gate per region tier", () => {
    expect(RELIC_STUDY_LANES_BY_LAB).toEqual([{ level: 1, lanes: 1 }, { level: 3, lanes: 2 }, { level: 5, lanes: 3 }, { level: 7, lanes: 4 }]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((l) => relicStudySlotCount(withLab(freshState(), l)))).toEqual([0, 1, 1, 2, 2, 3, 3, 4]);
    expect(relicStudyLanesAt(8)).toBe(4);
    // A Lab I identifies a Tier VII blank.
    const s = { ...withLab(freshState(), 1), relicVault: [blank("t7", { regionTier: 7, tier: "radiant" })] };
    expect(canStartRelicStudy(s, "t7")).toEqual({ ok: true });
  });

  it("the lane cap: a Lab V runs three studies, the fourth is refused", () => {
    let s: GameState = { ...withLab(freshState(), 5), relicVault: ["a", "b", "c", "d"].map((id) => blank(id)) };
    for (const id of ["a", "b", "c"]) s = startRelicStudy(s, id).next;
    expect(relicStudiesInFlight(s)).toHaveLength(3);
    expect(canStartRelicStudy(s, "d")).toEqual({ ok: false, reason: "noSlot" });
  });

  it("a new study carries the v2 stamp, is free, and lasts 10 minutes times its rarity", () => {
    const s = { ...freshState(), relicVault: [blank("r", { tier: "radiant" })] };
    const next = startRelicStudy(s, "r").next;
    const p = relicStudiesInFlight(next)[0];
    expect(p.effect).toMatchObject({ type: "identifyRelic", studyIndex: 1, v: RELIC_STUDY_VERSION });
    expect(p.durationTicks).toBe(relicStudyDurationTicks("radiant"));
    expect([relicStudyDurationTicks("standard"), relicStudyDurationTicks("augmented"), relicStudyDurationTicks("stellar"), relicStudyDurationTicks("radiant")]).toEqual([600, 900, 1200, 1800]);
    expect(next.credits.eq(s.credits)).toBe(true);
    expect(next.inventory).toBe(s.inventory);
  });
});

describe("R2-3 the identification queue", () => {
  const vault = (n: number, extra: (i: number) => Partial<RelicVaultToken> = () => ({})): RelicVaultToken[] =>
    Array.from({ length: n }, (_, i) => blank(`q-${i}`, { tier: (["standard", "augmented", "stellar", "radiant"] as const)[i % 4], ...extra(i) }));

  it("queueing with a free lane starts at once; with the lane busy it waits in the vault, in order", () => {
    let s: GameState = { ...freshState(), relicVault: vault(3) };
    s = queueRelicStudy(s, "q-0").next;
    expect(relicStudiesInFlight(s).map((p) => (p.effect as { token: RelicVaultToken }).token.id)).toEqual(["q-0"]);
    expect(s.relicQueue).toEqual([]);
    s = queueRelicStudy(s, "q-2").next;
    s = queueRelicStudy(s, "q-1").next;
    expect(s.relicQueue).toEqual(["q-2", "q-1"]);
    expect(s.relicVault.map((t) => t.id)).toEqual(["q-1", "q-2"]); // queued blanks stay in the vault
    expect(queueRelicStudy(s, "q-1")).toMatchObject({ queued: false, reason: "alreadyQueued" });
    expect(queueRelicStudy(s, "nope")).toMatchObject({ queued: false, reason: "notFound" });
  });

  it("reorder, remove, queue all, and a stale id dropped at the head", () => {
    let s: GameState = { ...freshState(), relicVault: vault(4), activeProcesses: [] };
    s = queueAllRelicStudies(s).next; // q-0 starts, q-1..q-3 wait
    expect(s.relicQueue).toEqual(["q-1", "q-2", "q-3"]);
    s = moveRelicQueueEntry(s, "q-3", -1);
    expect(s.relicQueue).toEqual(["q-1", "q-3", "q-2"]);
    expect(moveRelicQueueEntry(s, "q-1", -1)).toBe(s); // already at the head
    s = unqueueRelicStudy(s, "q-3");
    expect(s.relicQueue).toEqual(["q-1", "q-2"]);
    expect(s.relicVault.map((t) => t.id)).toContain("q-3"); // removed from the queue, still held
    expect(queueAllRelicStudies(s).queued).toBe(1);
    // A queued token that left the vault is dropped when it reaches the head.
    const stale = { ...withLab(s, 3), relicVault: s.relicVault.filter((t) => t.id !== "q-1") };
    const pumped = pumpRelicQueue(stale);
    expect(pumped.relicQueue).toEqual([]);
    expect(relicStudiesInFlight(pumped).map((p) => (p.effect as { token: RelicVaultToken }).token.id)).toEqual(["q-0", "q-2"]);
  });

  it("a manual start of a queued blank takes it out of the queue", () => {
    let s: GameState = withLab({ ...freshState(), relicVault: vault(3) }, 3);
    s = queueAllRelicStudies(s).next; // two lanes: q-0 and q-1 start, q-2 waits
    expect(s.relicQueue).toEqual(["q-2"]);
    const done = resolveProcesses(s, relicStudyDurationTicks("standard"), () => 0).next; // q-0 finishes, q-2 starts
    expect(done.relicQueue).toEqual([]);
    expect(relicStudiesInFlight(done)).toHaveLength(2);
  });

  it("the queue survives a save round trip", () => {
    const s: GameState = { ...freshState(), relicVault: vault(3) };
    const q = queueAllRelicStudies(s).next;
    const back = deserialize(serialize(q, 0))!;
    expect(back.state.relicQueue).toEqual(q.relicQueue);
  });

  // PARITY across a ten-token chain: every chunking lands the same Museum, registry, vault, queue, processes, counters
  // and log. Lab I (one lane) and Lab III (two lanes), plus a Lab II -> III upgrade landing mid-chain.
  const chainSeed = (level: number, upgradeAt?: number): GameState => {
    const base: GameState = withLab({ ...freshState(), relicVault: vault(10, (i) => ({ regionTier: ((i % 3) + 1) as RegionTier, ...(i % 2 ? { setId: "precursor" as const, poiId: "ancientRuins" } : {}) })) }, level);
    const queued = queueAllRelicStudies(base).next;
    if (upgradeAt === undefined) return queued;
    const up: TimedProcess = { id: "proc-990", kind: "facilityUpgrade", remainingTicks: upgradeAt, durationTicks: upgradeAt, effect: { type: "facilityLevelUp", facility: "research" } };
    return { ...queued, activeProcesses: [up, ...queued.activeProcesses] };
  };
  const snap = (s: GameState) => ({
    museum: s.museumV2,
    discovered: s.relicDiscovered,
    vault: s.relicVault.map((t) => t.id),
    queue: s.relicQueue,
    procs: s.activeProcesses,
    index: s.nextRelicStudyIndex,
    procId: s.nextProcessId,
    research: s.facilities.research,
    log: s.completionLog.map((e) => [e.kind, e.subjectKey]),
  });

  for (const [label, level, upgradeAt] of [["Lab I", 1, undefined], ["Lab III", 3, undefined], ["Lab II, upgraded to III mid-chain", 2, 1500]] as const) {
    it(`queue parity, ${label}: one resolve == 1 s resolves, and one tick() == 997 s chunks == 1 s economy ticks`, () => {
      const span = 10 * 1800 + 200;
      const one = resolveProcesses(chainSeed(level, upgradeAt), span, () => 0);
      let stepped = chainSeed(level, upgradeAt);
      let xp = 0;
      for (let i = 0; i < span; i++) {
        const r = resolveProcesses(stepped, 1, () => 0);
        stepped = r.next;
        xp += r.fleetAdminXpDelta;
      }
      // One big resolve records the completions of processes that were ALREADY in flight in activeProcesses order (the
      // resolver's documented N > 1 convention, every kind alike), so with a Lab upgrade beside the chain only the log's
      // ORDER may differ from 1 s steps; its entries, and everything else, are identical. (The game never resolves more
      // than one tick at once: tick() and the live loop both step economyTick one tick at a time, compared exactly below.)
      const sorted = (x: ReturnType<typeof snap>) => ({ ...x, log: [...x.log].map((e) => e.join("|")).sort() });
      expect(sorted(snap(one.next))).toEqual(sorted(snap(stepped)));
      if (upgradeAt === undefined) expect(snap(one.next)).toEqual(snap(stepped));
      expect(one.fleetAdminXpDelta).toBe(xp);
      // Non-vacuous: all ten identified, the queue emptied, no study left.
      expect(one.next.relicVault).toEqual([]);
      expect(one.next.relicQueue).toEqual([]);
      expect(relicStudiesInFlight(one.next)).toHaveLength(0);
      expect(one.next.completionLog.filter((e) => e.kind === "relicStudy")).toHaveLength(10);

      const offline = tick(span, chainSeed(level, upgradeAt), () => 0);
      let chunks = chainSeed(level, upgradeAt);
      for (let left = span; left > 0; left -= 997) chunks = tick(Math.min(997, left), chunks, () => 0);
      let live = chainSeed(level, upgradeAt);
      for (let i = 0; i < span; i++) live = economyTick(live, 1, () => 0);
      expect(snap(offline)).toEqual(snap(live));
      expect(snap(chunks)).toEqual(snap(live));
      expect({ xp: offline.fleetAdminXp.toString(), lvl: offline.fleetAdminLevel }).toEqual({ xp: live.fleetAdminXp.toString(), lvl: live.fleetAdminLevel });
    });
  }

  it("a mid-chain Lab upgrade opens the second lane at its completion tick", () => {
    const s = chainSeed(2, 300);
    const at = resolveProcesses(s, 300, () => 0).next;
    expect(at.facilities.research.level).toBe(3);
    expect(relicStudiesInFlight(at)).toHaveLength(2);
    const before = resolveProcesses(s, 299, () => 0).next;
    expect(relicStudiesInFlight(before)).toHaveLength(1);
  });

  it("a queue-started study identifies through v2 exactly as a player-started one with the same index would", () => {
    const s: GameState = { ...freshState(), relicVault: vault(2) };
    const q = queueAllRelicStudies(s).next;
    const done = resolveProcesses(q, 600 + 900, () => 0).next;
    const second = s.relicVault[1];
    const expected = identifyStudiedRelic(done, second, 2, RELIC_STUDY_VERSION, resolveProcesses(q, 600, () => 0).next.museumV2);
    expect(done.completionLog.filter((e) => e.kind === "relicStudy").map((e) => e.subjectKey)[1]).toBe(expected);
  });
});

describe("R2-3 in-flight v1 studies", () => {
  it("a study started before R2-3 (no stamp) keeps its v1 reveal; the same study stamped reveals through v2", () => {
    const t = sited("v1-a", "xenobiology", { tier: "stellar" });
    const s: GameState = { ...freshState(), relicVault: [t] };
    const started = startRelicStudy(s, "v1-a").next;
    const p = relicStudiesInFlight(started)[0];
    const asV1 = { ...started, activeProcesses: [{ ...p, effect: { type: "identifyRelic" as const, token: t, studyIndex: 1 } }] };
    const v1 = resolveProcesses(asV1, p.remainingTicks, () => 0).next;
    expect(v1.completionLog.at(-1)!.subjectKey).toBe(identifyStudiedRelic(s, t, 1));
    expect(v1.museumV2.cultures).toEqual({}); // the v1 roll never had a culture point
    const v2 = resolveProcesses(started, p.remainingTicks, () => 0).next;
    expect(v2.completionLog.at(-1)!.subjectKey).toBe(identifyStudiedRelic(s, t, 1, RELIC_STUDY_VERSION));
  });
});

describe("R2-3 wiring registry additions", () => {
  it("three audit rows: identification v2 and the lanes live, the queue pending its UI", () => {
    expect(
      WIRING_REGISTRY.filter((e) => R2_3_ADDED_ENTRY_IDS.has(e.id)).map((e) => `${e.id}|${e.status.kind}|${e.status.kind === "pending" ? e.status.owner : ""}`),
    ).toEqual([
      "relic:audit:identifyV2|live|",
      "relic:audit:identifyLanes|live|",
      "relic:audit:identifyQueue|live|", // R2-7: live with the Identification tab (probe content:relic:queue)
    ]);
  });

  it("makeRng is the stream identification v2 draws from (a sanity check on the seed)", () => {
    const seed = relicStudyV2Seed(RELIC_DEFAULT_SEED, 3, "x");
    expect(rollRelicIdentification(makeRng(seed), { regionTier: 1, rarity: "standard", siteSet: null, heldExceptional: {} })).toEqual(
      identifyRelicV2(RELIC_DEFAULT_SEED, emptyMuseumV2(), blank("x"), 3),
    );
  });
});
