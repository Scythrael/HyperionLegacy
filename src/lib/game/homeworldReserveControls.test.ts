// Homeworld reserve CONTROLS (user 2026-11-12 evening, docs/mockups/2026-11-12-homeworld-reserve-controls-mockup.html;
// docs/plans/2026-10-14-complement-and-acquisition-plan.md "USER ANSWERS (2026-11-12 evening)"): "Send to a ship" and
// "Recall to the pool" through crewTransfer.ts transferCrew with the reserve as the source, and the Send warning's count
// (homeworldReserve.ts poolSurplusNow). Covers: crew conserved, ranks and racials kept; Recall moves only what a berth
// can seat, so the next tick's sweep moves nothing back; the warning's count is exactly what the next tick moves;
// crew-locked ships refused with the reason; auto-crew ships refused (the picker lists them, not pickable); the reserve
// is never a target; a drained reserve is never written empty; the CP-21 perf memo still equals a fresh fill.
import { describe, expect, it } from "vitest";
import { freshState, type CrewBucket, type Expedition, type GameState, type ShipInstance, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { signatureKey, totalCrew } from "./crew";
import { tick } from "./tick";
import {
  CREW_POOL,
  HOMEWORLD_RESERVE,
  canTransferCrew,
  crewTransferBlockText,
  crewTransferGateText,
  crewTransferShortfallText,
  transferCrew,
  type CrewTransferPick,
} from "./crewTransfer";
import { fleetRoomReader, homeworldReserveCount, homeworldReserveOf, poolSurplusNow } from "./homeworldReserve";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { defaultDestination, transferDestinations, transferPreview } from "../crewTransferDisplay";

const DAY = 86400;
const FLEET: readonly ShipTypeKey[] = ["carrier", "eir", "orion", "aurora", "battleship"];
const EIR = "ship-3";
const AURORA = "ship-5";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ship-1 (the freighter) plus five parked passive hulls filled by the real resolveCrew from `days` of transports; the
// surplus is in the reserve, the pool empty, the next window 1,793 s away. Then the Aurora is MANUAL and emptied (its
// crew go nowhere: the test only needs open berths, so conservation is checked from this state on).
function openFleet(days = 8): GameState {
  const base = freshState();
  const extra: ShipInstance[] = FLEET.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  const filled = resolveCrew({
    ...base,
    ships: [...base.ships, ...extra],
    nextShipId: base.ships.length + extra.length + 1,
    gameTimeSeconds: days * DAY + 7,
    lastTransportWindow: 0,
  });
  return resolveCrew({
    ...filled,
    ships: filled.ships.map((sh) => (sh.id === AURORA ? { ...sh, complement: { buckets: [], mode: "active" as const } } : sh)),
  });
}

const everyone = (s: GameState): number =>
  totalCrew(s.crewPool) + homeworldReserveCount(s) + s.ships.reduce((n, sh) => n + totalCrew(sh.complement?.buckets ?? []), 0);
const shipOf = (s: GameState, id: string) => s.ships.find((sh) => sh.id === id)!;
const countIn = (list: readonly CrewBucket[], key: string): number => list.filter((b) => signatureKey(b) === key).reduce((n, b) => n + b.count, 0);
const allOf = (list: readonly CrewBucket[]): CrewTransferPick[] => list.map((b) => ({ signatureKey: signatureKey(b), count: b.count }));
function onExpedition(s: GameState, shipId: string): GameState {
  return { ...s, expeditions: [...s.expeditions, { id: `expedition-${shipId}`, shipId, phase: "transit" } as unknown as Expedition] };
}

describe("reserve controls: Recall moves only what a berth can seat", () => {
  it("recalls up to the fleet's open berths less what of the group waits in the pool; the rest stay (noBerth); crew conserved", () => {
    const s = openFleet();
    expect(s.crewPool).toEqual([]);
    expect(homeworldReserveCount(s)).toBeGreaterThan(0);
    const reserve = homeworldReserveOf(s);
    const res = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, allOf(reserve));
    expect(res.gate.ok).toBe(true);
    expect(res.moved).toBeGreaterThan(0);
    expect(res.moved).toBeLessThan(totalCrew(reserve));
    expect(everyone(res.next)).toBe(everyone(s));
    const room = fleetRoomReader(s);
    for (const r of res.results) {
      const b = reserve.find((x) => signatureKey(x) === r.signatureKey)!;
      // Each group: exactly min(what it has, the fleet's room for its division and rank) (the pool held none of it).
      expect(r.moved).toBe(Math.min(b.count, room(b)));
      expect(r.limitedBy).toBe(r.moved < b.count ? "noBerth" : null);
      // Ranks and racials kept: the same signature now waits in the pool.
      expect(countIn(res.next.crewPool, r.signatureKey)).toBe(r.moved);
      expect(countIn(homeworldReserveOf(res.next), r.signatureKey)).toBe(b.count - r.moved);
    }
    expect(res.results.some((r) => r.limitedBy === "noBerth")).toBe(true);
    expect(crewTransferShortfallText("noBerth")).toBe("no more berths in the fleet can seat that crew");
    // A second Recall of the same groups finds no room left (the pool now holds the fleet's room): the SAME state.
    const again = transferCrew(res.next, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(res.next)));
    expect(again.moved).toBe(0);
    expect(again.next).toBe(res.next);
  });

  it("nothing bounces: the next tick's sweep moves nobody back to the reserve", () => {
    const s = openFleet();
    const res = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(s)));
    expect(poolSurplusNow(res.next)).toEqual([]);
    const after = tick(1, res.next, lcg(7));
    expect(after.crewPool).toEqual(res.next.crewPool);
    expect(homeworldReserveOf(after)).toEqual(homeworldReserveOf(res.next));
    // And a full fill pass on its own leaves the pool as the recall left it.
    expect(resolveCrew(res.next).crewPool).toEqual(res.next.crewPool);
  });

  it("an auto-crew ship that is out keeps its open berths for a Recall; home, it takes the pool's crew first", () => {
    const base = openFleet();
    // The Eir emptied and on an expedition (crew-locked, passive): its open berths count.
    const out = resolveCrew(
      onExpedition({ ...base, ships: base.ships.map((sh) => (sh.id === EIR ? { ...sh, complement: { buckets: [], mode: "passive" as const } } : sh)) }, EIR),
    );
    const res = transferCrew(out, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(out)));
    expect(res.moved).toBeGreaterThan(0);
    const swept = resolveCrew(res.next);
    expect(swept.crewPool).toEqual(res.next.crewPool);
    expect(homeworldReserveOf(swept)).toEqual(homeworldReserveOf(res.next));
    // Claimed (home): the Eir fills, from the pool first.
    const home = resolveCrew({ ...res.next, expeditions: [] });
    expect(totalCrew(shipOf(home, EIR).complement!.buckets)).toBeGreaterThan(0);
    expect(totalCrew(home.crewPool)).toBeLessThan(totalCrew(res.next.crewPool));
  });
});

describe("reserve controls: Send to a ship", () => {
  it("moves reserve groups into a manual ship's open berths, cap-aware, ranks and racials kept, nobody lost; they stay put", () => {
    const s = openFleet();
    const reserve = homeworldReserveOf(s);
    const res = transferCrew(s, HOMEWORLD_RESERVE, AURORA, allOf(reserve));
    expect(res.gate.ok).toBe(true);
    expect(res.moved).toBeGreaterThan(0);
    expect(everyone(res.next)).toBe(everyone(s));
    const aboard = shipOf(res.next, AURORA).complement!.buckets;
    expect(totalCrew(aboard)).toBe(res.moved);
    for (const r of res.results) {
      expect(countIn(aboard, r.signatureKey)).toBe(r.moved);
      if (r.moved < r.requested) expect(r.limitedBy).toBe("targetFull");
    }
    // The ship's crew are never swept: a tick later they are all still aboard.
    const after = tick(1, res.next, lcg(3));
    expect(shipOf(after, AURORA).complement!.buckets).toEqual(aboard);
  });

  it("a drained reserve is never written empty", () => {
    const base = freshState();
    const g: CrewBucket = { profession: "medical", rarity: "standard", rank: 1, race: "belter", buff1Id: CREW_PROFESSION_BUFFS.medical[0].id, buff2Id: null, count: 3 };
    const s: GameState = { ...base, homeworldReserve: [g], ships: base.ships.map((sh) => ({ ...sh, complement: { buckets: [], mode: "active" as const } })) };
    const res = transferCrew(s, HOMEWORLD_RESERVE, "ship-1", [{ signatureKey: signatureKey(g), count: 3 }]);
    expect(res.moved).toBe(3);
    expect("homeworldReserve" in res.next).toBe(false);
  });

  it("the warning's count is exactly what the next tick's sweep moves out of the pool", () => {
    const s = openFleet();
    // Recall first, so the pool holds crew for the Aurora's open berths; then Send the reserve's rest to the Aurora.
    const recalled = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(s))).next;
    const picks = allOf(homeworldReserveOf(recalled));
    const preview = transferPreview(recalled, HOMEWORLD_RESERVE, AURORA, picks);
    const sent = transferCrew(recalled, HOMEWORLD_RESERVE, AURORA, picks);
    expect(sent.moved).toBeGreaterThan(0);
    const surplus = poolSurplusNow(sent.next);
    const warned = surplus.reduce((n, e) => n + e.count, 0);
    expect(warned).toBeGreaterThan(0);
    expect(preview.swapCount).toBe(warned);
    expect(preview.swapWarning).toContain("move to the reserve at the next tick");
    const after = tick(1, sent.next, lcg(11));
    expect(totalCrew(sent.next.crewPool) - totalCrew(after.crewPool)).toBe(warned);
    expect(homeworldReserveCount(after) - homeworldReserveCount(sent.next)).toBe(warned);
    for (const e of surplus) {
      expect(countIn(sent.next.crewPool, e.signatureKey) - countIn(after.crewPool, e.signatureKey)).toBe(e.count);
    }
    expect(everyone(after)).toBe(everyone(s));
    // No warning when nothing would move (a Send into a fleet whose pool is empty).
    expect(transferPreview(s, HOMEWORLD_RESERVE, AURORA, allOf(homeworldReserveOf(s))).swapCount).toBe(0);
  });
});

describe("the pool's own Send: the same warning (user 2026-11-12 'Yes, same warning (Recommended)')", () => {
  it("its count is exactly what the next tick's sweep moves out of the pool", () => {
    const s = openFleet();
    // Recall first so the pool holds crew for the Aurora's berths; then Send one pool group from the pool to the Aurora.
    const recalled = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(s))).next;
    let checked = 0;
    for (const g of recalled.crewPool) {
      const picks = [{ signatureKey: signatureKey(g), count: g.count }];
      const preview = transferPreview(recalled, CREW_POOL, AURORA, picks);
      const sent = transferCrew(recalled, CREW_POOL, AURORA, picks);
      if (sent.moved === 0) continue;
      const surplus = poolSurplusNow(sent.next);
      const warned = surplus.reduce((n, e) => n + e.count, 0);
      expect(preview.swapCount).toBe(warned);
      const after = tick(1, sent.next, lcg(13));
      expect(totalCrew(sent.next.crewPool) - totalCrew(after.crewPool)).toBe(warned);
      expect(homeworldReserveCount(after) - homeworldReserveCount(sent.next)).toBe(warned);
      expect(everyone(after)).toBe(everyone(s));
      if (warned > 0) {
        expect(preview.swapWarning).toContain("move to the reserve at the next tick");
        checked += 1;
      } else {
        expect(preview.swapWarning).toBeNull();
      }
      if (checked >= 3) break;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("reserve controls: refusals", () => {
  it("a crew-locked ship is refused with the real reason (the SAME state)", () => {
    const s = onExpedition(openFleet(), AURORA);
    const picks = allOf(homeworldReserveOf(s)).slice(0, 2);
    const res = transferCrew(s, HOMEWORLD_RESERVE, AURORA, picks);
    expect(res.gate).toEqual({ ok: false, reason: "onMission", shipId: AURORA });
    expect(res.next).toBe(s);
    expect(crewTransferGateText(s, res.gate)).toBe("Ship is on an expedition");
    const card = transferDestinations(s, HOMEWORLD_RESERVE).find((c) => c.id === AURORA)!;
    expect(card.status).toBe("locked");
    expect(card.pickable).toBe(false);
    expect(card.warn).toBe("Ship is on an expedition: crew locked until its expedition is claimed.");
  });

  it("an auto-crew ship is refused, and the picker lists it, not pickable, with no switch and a note that it fills itself", () => {
    const s = openFleet();
    const picks = allOf(homeworldReserveOf(s)).slice(0, 1);
    expect(canTransferCrew(s, HOMEWORLD_RESERVE, EIR, picks)).toEqual({ ok: false, reason: "autoCrew", shipId: EIR });
    const cards = transferDestinations(s, HOMEWORLD_RESERVE);
    const eir = cards.find((c) => c.id === EIR)!;
    expect(eir.pickable).toBe(false);
    expect(eir.canSwitchToManual).toBe(false);
    expect(eir.warn).toBeNull();
    expect(eir.info).toBe("Auto-crew: fills from the pool, then this reserve, on its own every tick.");
    expect(eir.shortInfo).toBe("Draws from the reserve on its own.");
    // Send starts on the first ship with room (the manual Aurora), Recall on the crew pool.
    expect(defaultDestination(cards, "ship")).toBe(AURORA);
    expect(defaultDestination(cards, "pool")).toBe(CREW_POOL);
    expect(cards[0]).toMatchObject({ id: CREW_POOL, pickable: true });
    expect(cards[0].line).toContain("recall what a berth can seat");
  });

  it("the reserve is never a target; reserve to reserve is the same endpoint", () => {
    const s = openFleet();
    const pick = allOf(homeworldReserveOf(s)).slice(0, 1);
    expect(canTransferCrew(s, CREW_POOL, HOMEWORLD_RESERVE, pick)).toEqual({ ok: false, reason: "intoReserve" });
    expect(canTransferCrew(s, AURORA, HOMEWORLD_RESERVE, pick)).toEqual({ ok: false, reason: "intoReserve" });
    expect(canTransferCrew(s, HOMEWORLD_RESERVE, HOMEWORLD_RESERVE, pick)).toEqual({ ok: false, reason: "sameEndpoint" });
    expect(crewTransferBlockText("intoReserve")).toBe("Crew move to the Homeworld reserve only on their own");
  });
});

describe("reserve controls: the CP-21 perf memo stays correct", () => {
  it("after a Send and a Recall, the tick's fill equals a fresh fill on a structured clone (no memo)", () => {
    const s = openFleet();
    const recalled = transferCrew(s, HOMEWORLD_RESERVE, CREW_POOL, allOf(homeworldReserveOf(s))).next;
    // Warm the memo on the recalled state, then act on it.
    const warm = resolveCrew(recalled);
    const sent = transferCrew(warm, HOMEWORLD_RESERVE, AURORA, allOf(homeworldReserveOf(warm))).next;
    // (toEqual, the crewPoolGuard.test.ts rule: a structured clone carries no memo entry.)
    for (const st of [recalled, warm, sent]) {
      expect(resolveCrew(st)).toEqual(resolveCrew(structuredClone(st)));
    }
    // Several ticks on, the crew of a memoized run and of a run whose crew lists are copied every tick (no memo can hit)
    // agree. (Only the crew lists are copied: a structured clone would drop the credits' Decimal.)
    const unmemo = (st: GameState): GameState => ({
      ...st,
      crewPool: st.crewPool.map((g) => ({ ...g })),
      ...(st.homeworldReserve ? { homeworldReserve: st.homeworldReserve.map((g) => ({ ...g })) } : {}),
      ships: st.ships.map((sh) => (sh.complement ? { ...sh, complement: { ...sh.complement, buckets: sh.complement.buckets.map((g) => ({ ...g })) } } : { ...sh })),
    });
    const crewOf = (st: GameState) => ({ pool: st.crewPool, reserve: homeworldReserveOf(st), ships: st.ships.map((sh) => sh.complement) });
    let a = sent;
    let b = unmemo(sent);
    const ra = lcg(5);
    const rb = lcg(5);
    for (let i = 0; i < 30; i += 1) {
      a = tick(1, a, ra);
      b = tick(1, unmemo(b), rb);
    }
    expect(crewOf(a)).toEqual(crewOf(b));
  });
});
