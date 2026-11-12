// Homeworld reserve (user 2026-11-12, "Homeworld reserve (Recommended)"; homeworldReserve.ts). The whole-state pins and
// the one call == 997 s chunks == 1 s steps parity (a two-day catch-up among them) are homeworldReserveGoldens.test.ts;
// the wall-clock bound is crewPool.perf.test.ts. Here: the surplus rule, the reserve draw, the guard and the save.
import { describe, expect, it } from "vitest";
import { freshState, type CrewBucket, type CrewProfession, type GameState, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { signatureKey, totalCrew } from "./crew";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { complementTotalCap, remainingCapacityForSignature } from "./commandStructure";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { homeworldReserveCount, homeworldReserveOf, sweepSurplusToReserve, withHomeworldReserveOnLoad } from "./homeworldReserve";
import { withHomeworldReserveOff } from "./homeworldReserveSwitch.fixture";
import { applyRoster, createRoster } from "./personnelRosters";
import { deserialize, migrate, serialize } from "./save";

const PROFS: readonly CrewProfession[] = ["operations", "engineering", "security", "science", "medical", "flightDeck"];

function group(profession: CrewProfession, count: number, rank: CrewBucket["rank"] = 1): CrewBucket {
  return { profession, rarity: "standard", rank, race: "belter", buff1Id: CREW_PROFESSION_BUFFS[profession][0].id, buff2Id: null, count };
}
const everyDivision = (count: number): CrewBucket[] => PROFS.map((p) => group(p, count));

// ship-1 re-hulled with the given complement mode and crew, `crewPool` waiting. `due` true puts one transport window due.
function fleetOf(hull: ShipTypeKey, mode: "passive" | "active", crewPool: CrewBucket[], due: boolean, reserve?: CrewBucket[]): GameState {
  const base = freshState();
  return {
    ...base,
    crewPool,
    ...(reserve ? { homeworldReserve: reserve } : {}),
    gameTimeSeconds: due ? TRANSPORT_WINDOW_SECONDS + 5 : 5,
    lastTransportWindow: 0,
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull, complement: { buckets: [], mode } } : sh)),
  };
}
const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === "ship-1")!;
const crewOnShip1 = (s: GameState): number => totalCrew(ship1(s).complement?.buckets ?? []);
const everyone = (s: GameState): number => totalCrew(s.crewPool) + homeworldReserveCount(s) + s.ships.reduce((n, sh) => n + totalCrew(sh.complement?.buckets ?? []), 0);
const countOf = (list: CrewBucket[], b: CrewBucket): number => list.filter((x) => signatureKey(x) === signatureKey(b)).reduce((n, x) => n + x.count, 0);

// A full passive freighter (filled by the real resolveCrew, no window due), the pool emptied.
function fullFreighter(): GameState {
  const filled = resolveCrew(fleetOf("generalFreighter", "passive", everyDivision(500), false));
  expect(crewOnShip1(filled)).toBe(complementTotalCap("generalFreighter"));
  return filled;
}

describe("homeworld reserve: the surplus moves only when no berth can take it", () => {
  it("every berth full: at a transport window the whole leftover moves, and nobody is lost", () => {
    // An old save's full freighter with its leftover still in the pool (built before the reserve).
    const full = withHomeworldReserveOff(() => fullFreighter());
    expect(totalCrew(full.crewPool)).toBeGreaterThan(0);
    const before = everyone(full);
    const s = resolveCrew({ ...full, gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 5 });
    expect(s.crewPool).toEqual([]);
    // The pool's leftover plus the transport's crew, every one now in the reserve, the same groups.
    expect(homeworldReserveCount(s)).toBe(totalCrew(full.crewPool) + 12);
    expect(everyone(s)).toBe(before + 12);
    for (const b of full.crewPool) expect(countOf(homeworldReserveOf(s), b)).toBeGreaterThanOrEqual(b.count);
    // Kept in canonical order (signature key), so every chunking of time leaves the same list.
    const keys = homeworldReserveOf(s).map(signatureKey);
    expect(keys).toEqual([...keys].sort());
  });

  it("the sweep follows every fill, not only a transport: crew no berth can take never wait in the pool", () => {
    // fullFreighter's own fill already swept: the leftover is in the reserve, the pool empty.
    const full = fullFreighter();
    expect(full.crewPool).toEqual([]);
    expect(homeworldReserveCount(full)).toBe(500 * PROFS.length - complementTotalCap("generalFreighter"));
    // A crewmember landing in the pool between windows (a salvage, a send back) with no berth for them moves at the next tick.
    const landed = { ...full, crewPool: [group("medical", 7)] };
    const out = resolveCrew(landed);
    expect(out.crewPool).toEqual([]);
    expect(homeworldReserveCount(out)).toBe(homeworldReserveCount(full) + 7);
    // Then nothing is left to do: the same state comes back.
    expect(resolveCrew(out)).toBe(out);
  });

  it("a manual ship's open berths keep what they could take; only the rest moves", () => {
    const s0 = fleetOf("generalFreighter", "active", [group("operations", 5000), group("science", 5000)], true);
    const s = resolveCrew(s0);
    const empty = { buckets: [], mode: "active" as const };
    for (const b of s0.crewPool) {
      const room = remainingCapacityForSignature(empty, "generalFreighter", b, 0);
      expect(room).toBeGreaterThan(0);
      expect(room).toBeLessThan(5000);
      expect(countOf(s.crewPool, b)).toBe(room);
      expect(countOf(homeworldReserveOf(s), b)).toBe(5000 - room);
    }
    // The manual ship took nobody on its own.
    expect(crewOnShip1(s)).toBe(0);
  });

  it("the sweep keeps, per group, the sum of every ship's own room for its division and rank", () => {
    const base = freshState();
    const s: GameState = {
      ...base,
      ships: [
        { ...base.ships[0], complement: { buckets: [], mode: "active" } },
        { id: "ship-2", typeKey: "eir", assignedCaptainId: null, complement: { buckets: [], mode: "active" } },
      ],
    };
    const g = group("medical", 100000);
    const room = (hull: ShipTypeKey) => remainingCapacityForSignature({ buckets: [], mode: "active" }, hull, g, 0);
    const out = sweepSurplusToReserve(s, [g], []);
    expect(out.pool).toEqual([{ ...g, count: room(s.ships[0].typeKey) + room("eir") }]);
    expect(totalCrew(out.reserve)).toBe(100000 - room(s.ships[0].typeKey) - room("eir"));
    // Nothing to move: the SAME lists come back.
    const none = sweepSurplusToReserve(s, out.pool, out.reserve);
    expect(none.pool).toBe(out.pool);
    expect(none.reserve).toBe(out.reserve);
  });
});

describe("homeworld reserve: ships refill from the pool first, then the reserve", () => {
  function freed(s: GameState, n: number): { state: GameState; sig: CrewBucket } {
    const sig = ship1(s).complement!.buckets[0];
    const buckets = ship1(s).complement!.buckets.map((b, i) => (i === 0 ? { ...b, count: b.count - n } : b));
    return { state: { ...s, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "passive" as const } } : sh)) }, sig };
  }

  it("a freed berth with an empty pool draws from the reserve", () => {
    const swept = resolveCrew({ ...fullFreighter(), gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 5 });
    expect(swept.crewPool).toEqual([]);
    const { state, sig } = freed(swept, 5);
    const reserveBefore = homeworldReserveCount(state);
    const out = resolveCrew(state);
    expect(crewOnShip1(out)).toBe(complementTotalCap("generalFreighter"));
    expect(homeworldReserveCount(out)).toBe(reserveBefore - 5);
    expect(everyone(out)).toBe(everyone(state));
    // The same draw a fresh fill makes (no remembered state applies on a structured clone).
    expect(resolveCrew(structuredClone(state))).toEqual(out);
    expect(sig.count).toBeGreaterThan(5);
  });

  it("the pool is drawn first: the reserve covers only what the pool cannot", () => {
    const full = fullFreighter();
    const { state: holed, sig } = freed({ ...full, crewPool: [] }, 5);
    const state = { ...holed, crewPool: [{ ...sig, count: 3 }], homeworldReserve: [{ ...sig, count: 10 }] };
    const out = resolveCrew(state);
    expect(crewOnShip1(out)).toBe(complementTotalCap("generalFreighter"));
    expect(out.crewPool).toEqual([]);
    expect(homeworldReserveOf(out)).toEqual([{ ...sig, count: 8 }]);
  });

  it("a reserve drawn empty leaves no field behind", () => {
    const full = fullFreighter();
    const { state: holed, sig } = freed({ ...full, crewPool: [] }, 5);
    const out = resolveCrew({ ...holed, homeworldReserve: [{ ...sig, count: 5 }] });
    expect(crewOnShip1(out)).toBe(complementTotalCap("generalFreighter"));
    expect("homeworldReserve" in out).toBe(false);
  });

  it("a Personnel roster's bulk fill draws from the reserve after the pool", () => {
    const full = fullFreighter();
    const { state: holed, sig } = freed({ ...full, crewPool: [] }, 5);
    const withRoster = createRoster({ ...holed, homeworldReserve: [{ ...sig, count: 9 }] }, { name: "R" }).next;
    const applied = applyRoster(withRoster, "roster-1", "ship-1");
    expect(crewOnShip1(applied)).toBe(complementTotalCap("generalFreighter"));
    expect(homeworldReserveOf(applied)).toEqual([{ ...sig, count: 4 }]);
  });
});

describe("homeworld reserve: the CP-21 guard covers the reserve", () => {
  it("a full ship and an idle reserve: the same state comes back, equal to a fresh fill", () => {
    const swept = resolveCrew({ ...fullFreighter(), gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 5 });
    expect(homeworldReserveCount(swept)).toBeGreaterThan(0);
    expect(resolveCrew(swept)).toBe(swept);
    expect(resolveCrew(structuredClone(swept))).toEqual(swept);
  });

  it("a ship with free berths but nothing it can seat in the pool or the reserve: remembered, equal to a fresh fill", () => {
    const once = resolveCrew(fleetOf("carrier", "passive", [], false, [group("flightDeck", 50000)]));
    expect(crewOnShip1(once)).toBeGreaterThan(0);
    expect(crewOnShip1(once)).toBeLessThan(complementTotalCap("carrier"));
    const again = resolveCrew(once);
    expect(again).toBe(once);
    expect(resolveCrew(structuredClone(once))).toEqual(once);
    // A new reserve (another group added) is filled in full again.
    const more = { ...once, homeworldReserve: [...homeworldReserveOf(once), group("security", 20)] };
    const out = resolveCrew(more);
    expect(out).toEqual(resolveCrew(structuredClone(more)));
    expect(crewOnShip1(out)).toBe(crewOnShip1(once) + 20);
  });

  it("with the switch off the reserve is never drawn or written (the game before it)", () => {
    withHomeworldReserveOff(() => {
      const full = fullFreighter();
      const at = resolveCrew({ ...full, gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 5 });
      expect(at.homeworldReserve).toBeUndefined();
      expect(totalCrew(at.crewPool)).toBe(totalCrew(full.crewPool) + 12);
      const held = fleetOf("generalFreighter", "passive", [], false, [group("operations", 10)]);
      expect(resolveCrew(held)).toBe(held);
    });
  });
});

describe("homeworld reserve: saves", () => {
  it("round-trips through a save, and the every-load step keeps a well-formed reserve as it is", () => {
    const swept = resolveCrew({ ...fullFreighter(), gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 5 });
    const loaded = migrate(deserialize(serialize(swept, 0, 0))!, 1);
    expect(homeworldReserveOf(loaded)).toEqual(homeworldReserveOf(swept));
    expect(withHomeworldReserveOnLoad(swept)).toBe(swept);
  });

  it("a save without the field is untouched; an empty or malformed one is dropped", () => {
    const plain = freshState();
    expect(withHomeworldReserveOnLoad(plain)).toBe(plain);
    expect("homeworldReserve" in withHomeworldReserveOnLoad({ ...plain, homeworldReserve: [] })).toBe(false);
    expect("homeworldReserve" in withHomeworldReserveOnLoad({ ...plain, homeworldReserve: "junk" })).toBe(false);
    const g = group("medical", 3);
    expect(withHomeworldReserveOnLoad({ ...plain, homeworldReserve: [g, { ...g, count: 0 }, null] }).homeworldReserve).toEqual([g]);
    expect(withHomeworldReserveOnLoad(null)).toBeNull();
  });

  it("duplicate groups of one signature (a hand-edited save) are merged at load, so a draw can never mint crew", () => {
    const full = fullFreighter();
    const sig = ship1(full).complement!.buckets[0];
    const buckets = ship1(full).complement!.buckets.map((b, i) => (i === 0 ? { ...b, count: b.count - 5 } : b));
    const holed: GameState = { ...full, crewPool: [], ships: full.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "passive" as const } } : sh)) };
    const edited = { ...holed, homeworldReserve: [{ ...sig, count: 2 }, group("medical", 1, 2), { ...sig, count: 2 }] };
    const loaded = withHomeworldReserveOnLoad(edited);
    expect(countOf(homeworldReserveOf(loaded), sig)).toBe(4);
    expect(homeworldReserveOf(loaded).filter((b) => signatureKey(b) === signatureKey(sig))).toHaveLength(1);
    expect(homeworldReserveCount(loaded)).toBe(5);
    // The freed berths take the four of the signature, and nobody appears from nowhere.
    const out = resolveCrew(loaded);
    expect(countOf(homeworldReserveOf(out), sig)).toBe(0);
    expect(crewOnShip1(out) - crewOnShip1(holed)).toBe(homeworldReserveCount(loaded) - homeworldReserveCount(out));
    expect(crewOnShip1(out) - crewOnShip1(holed)).toBeGreaterThanOrEqual(4);
    expect(everyone(out)).toBe(everyone(loaded));
    // A well-formed reserve (no duplicates) is kept as it is.
    expect(withHomeworldReserveOnLoad(loaded)).toBe(loaded);
  });

  it("an old save's pool is not moved at load: the engine moves its surplus at the first tick after", () => {
    const full = withHomeworldReserveOff(() => fullFreighter());
    const loaded = migrate(deserialize(serialize(full, 0, 0))!, 1);
    expect(loaded.homeworldReserve).toBeUndefined();
    expect(totalCrew(loaded.crewPool)).toBe(totalCrew(full.crewPool));
    const ticked = resolveCrew(loaded);
    expect(ticked.crewPool).toEqual([]);
    expect(homeworldReserveCount(ticked)).toBe(totalCrew(full.crewPool));
  });
});
