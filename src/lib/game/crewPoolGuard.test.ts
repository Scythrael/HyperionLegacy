// CP-21 close-out: the crew pool perf guard in crewOverlay.ts resolveCrew changes no outcome. The whole-state pins are
// crewPoolGuardGoldens.test.ts (captured before the guard); the wall-clock bound is crewPool.perf.test.ts (npm run
// test:perf). Here: each skip returns exactly what the full fill returns, checked against a structured clone (fresh
// object references, so no remembered fill can apply) of the same state.
import { describe, expect, it } from "vitest";
import { freshState, type CrewBucket, type CrewProfession, type GameState, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { complementTotalCap } from "./commandStructure";
import { withHullCrewCapsOff } from "./hullCrewCapsSwitch.fixture";

function pool(profession: CrewProfession, count: number): CrewBucket[] {
  return [{ profession, rarity: "standard", rank: 1, race: "belter", buff1Id: CREW_PROFESSION_BUFFS[profession][0].id, buff2Id: null, count }];
}

// ship-1 re-hulled, passive and empty, with `crewPool` waiting and no transport due.
function withPool(hull: ShipTypeKey, crewPool: CrewBucket[]): GameState {
  const base = freshState();
  return {
    ...base,
    crewPool,
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull, complement: { buckets: [], mode: "passive" as const } } : sh)),
  };
}

const crewOnShip1 = (s: GameState): number => totalCrew(s.ships.find((sh) => sh.id === "ship-1")!.complement?.buckets ?? []);
const fresh = (s: GameState): GameState => structuredClone(s);

describe("CP-21 crew pool guard: every skip equals the full fill", () => {
  it("a full ship and an idle pool: the same state comes back, equal to a fresh fill", () => {
    const filled = resolveCrew(withPool("generalFreighter", [...pool("operations", 500), ...pool("engineering", 500), ...pool("security", 500), ...pool("science", 500), ...pool("medical", 500), ...pool("flightDeck", 500)]));
    expect(crewOnShip1(filled)).toBe(complementTotalCap("generalFreighter"));
    expect(resolveCrew(filled)).toBe(filled);
    expect(resolveCrew(fresh(filled))).toEqual(filled);
  });

  it("a ship with free berths but nothing in the pool it can seat: remembered, equal to a fresh fill", () => {
    // Only Flight Deck crew wait: the carrier seats its Flight Deck division and the rest of its berths stay empty.
    const once = resolveCrew(withPool("carrier", pool("flightDeck", 500)));
    expect(crewOnShip1(once)).toBeGreaterThan(0);
    expect(crewOnShip1(once)).toBeLessThan(complementTotalCap("carrier"));
    const again = resolveCrew(once);
    expect(again).toBe(once);
    expect(resolveCrew(fresh(once))).toEqual(once);
  });

  it("the remembered fill never outlives a cap change (the CP-5 switch)", () => {
    // Remembered with the per-hull caps off (the spec template's smaller Flight Deck), then read with them on.
    const off = withHullCrewCapsOff(() => {
      const s = resolveCrew(withPool("carrier", pool("flightDeck", 500)));
      expect(resolveCrew(s)).toBe(s);
      return s;
    });
    const on = resolveCrew(off);
    expect(on).toEqual(resolveCrew(fresh(off)));
    expect(crewOnShip1(on)).toBeGreaterThan(crewOnShip1(off));
  });

  it("a new pool (a transfer back, a salvage) is filled in full again", () => {
    const once = resolveCrew(withPool("carrier", pool("flightDeck", 500)));
    const more = { ...once, crewPool: [...once.crewPool, ...pool("security", 20)] };
    const out = resolveCrew(more);
    expect(out).toEqual(resolveCrew(fresh(more)));
    expect(crewOnShip1(out)).toBe(crewOnShip1(once) + 20);
  });

  it("a mode switch or a freed berth is filled in full again", () => {
    const once = resolveCrew(withPool("carrier", pool("flightDeck", 500)));
    const ship = once.ships.find((sh) => sh.id === "ship-1")!;
    const freed = {
      ...once,
      ships: once.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [{ ...ship.complement!.buckets[0], count: ship.complement!.buckets[0].count - 5 }], mode: "passive" as const } } : sh)),
    };
    const refilled = resolveCrew(freed);
    expect(refilled).toEqual(resolveCrew(fresh(freed)));
    expect(crewOnShip1(refilled)).toBe(crewOnShip1(once));
  });
});
