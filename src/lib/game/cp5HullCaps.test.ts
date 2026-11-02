// Complement plan CP-5 (per-hull crew caps; user 2026-10-16 OC-5 "Eir 900, Orion/Aurora 750 (Recommended)" with the
// division leans, OC-6 "Never evict (Recommended)"; WR-7 review "a quarters bonus never removes a seat"): the rules.

import { describe, expect, it } from "vitest";
import { freshState, SHIP_TYPES, type CrewBucket, type CrewProfession, type CrewRank, type GameState, type ShipTypeKey } from "./model";
import {
  CREW_PROFESSIONS,
  canAddToComplement,
  commandStructureForHull,
  commandStructureWithBonus,
  complementOverCap,
  complementTotalCap,
  countInDivision,
  divisionCap,
  inclusiveRankCap,
  remainingCapacityForSignature,
} from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { autoCrewShip } from "./autoCrew";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { withHullCrewCapsOff } from "./hullCrewCapsSwitch.fixture";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
// The Andromeda (user 2026-10-16: "the Andromeda has 1017. That's the largest."), a later hull tier: every 0.14.0 hull
// stays below it.
const ANDROMEDA_CREW = 1017;

function bucket(profession: CrewProfession, rank: CrewRank, count: number): CrewBucket {
  return { profession, rarity: "standard", rank, race: "earthBorn", buff1Id: CREW_PROFESSION_BUFFS[profession][0].id, buff2Id: null, count };
}
function deepPool(): CrewBucket[] {
  const out: CrewBucket[] = [];
  for (const p of CREW_PROFESSIONS) for (const r of CREW_RANK_ORDER) out.push(bucket(p, r, 400));
  return out;
}
// A complement filled to every division cap of `hull` with Crewmen (trimmed to the total), on the templates live NOW.
function fullCrewmen(hull: ShipTypeKey): CrewBucket[] {
  const out: CrewBucket[] = [];
  let left = complementTotalCap(hull);
  for (const p of CREW_PROFESSIONS) {
    const n = Math.min(left, divisionCap(hull, p));
    out.push(bucket(p, 1, n));
    left -= n;
  }
  return out;
}
function withShip(hull: ShipTypeKey, buckets: CrewBucket[], over: Partial<GameState> = {}): GameState {
  const base = freshState();
  return { ...base, ...over, ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull, complement: { buckets, mode: "passive" } } : sh)) };
}
const ship1 = (s: GameState) => s.ships.find((sh) => sh.id === "ship-1")!;

describe("CP-5 per-hull caps (OC-5)", () => {
  it("the Eir carries the largest explorer crew, 900; the Orion and Aurora keep 750; all stay below the Andromeda", () => {
    expect(complementTotalCap("eir")).toBe(900);
    expect(complementTotalCap("orion")).toBe(750);
    expect(complementTotalCap("aurora")).toBe(750);
    expect(complementTotalCap("eir")).toBeGreaterThan(complementTotalCap("orion"));
    for (const h of HULLS) expect(complementTotalCap(h), h).toBeLessThan(ANDROMEDA_CREW);
  });

  it("no hull's total shrinks, and every hull without an override keeps its template exactly", () => {
    for (const h of HULLS) {
      const before = withHullCrewCapsOff(() => commandStructureForHull(h));
      const now = commandStructureForHull(h);
      expect(now.total, h).toBeGreaterThanOrEqual(before.total);
      if (SHIP_TYPES[h].complementCap === undefined && SHIP_TYPES[h].complementDivisionWeights === undefined) expect(now, h).toEqual(before);
    }
  });

  it("the switch never serves a template cached on the other side", () => {
    const on = commandStructureForHull("eir");
    const off = withHullCrewCapsOff(() => commandStructureForHull("eir"));
    expect(on.total).toBe(900);
    expect(off.total).toBe(750);
    expect(commandStructureForHull("eir")).toBe(on);
    expect(withHullCrewCapsOff(() => commandStructureWithBonus("eir", 12)).total).toBe(762);
    expect(commandStructureWithBonus("eir", 12).total).toBe(912);
  });

  it("each override's division mix sums to 1, and the leans point where OC-5 says", () => {
    for (const h of HULLS) {
      const w = SHIP_TYPES[h].complementDivisionWeights;
      if (!w) continue;
      expect(CREW_PROFESSIONS.reduce((a, p) => a + w[p], 0), h).toBeCloseTo(1, 9);
    }
    const lean = (h: ShipTypeKey, p: CrewProfession) => divisionCap(h, p) - withHullCrewCapsOff(() => divisionCap(h, p));
    expect(lean("eir", "medical")).toBeGreaterThan(0);
    expect(lean("eir", "science")).toBeGreaterThan(0);
    expect(lean("aurora", "science")).toBeGreaterThan(0);
    expect(lean("carrier", "flightDeck")).toBeGreaterThan(0);
    expect(lean("battleship", "security")).toBeGreaterThan(0);
    expect(lean("battleship", "engineering")).toBeGreaterThan(0);
  });

  it("the Eir loses no seat in any division at any rank against the explorer template it had", () => {
    const before = withHullCrewCapsOff(() => commandStructureForHull("eir"));
    for (const p of CREW_PROFESSIONS) {
      expect(divisionCap("eir", p), p).toBeGreaterThanOrEqual(before.divisions[p].cap);
    }
    expect(CREW_PROFESSIONS.reduce((a, p) => a + divisionCap("eir", p), 0)).toBe(900);
  });

  it("WR-7 rule holds on the new templates: a quarters bonus never removes a seat (bonus 1 to 200, every hull)", () => {
    for (const h of HULLS) {
      for (let b = 1; b <= 200; b++) {
        for (const p of CREW_PROFESSIONS) {
          for (const r of CREW_RANK_ORDER) {
            if (inclusiveRankCap(h, p, r, b) < inclusiveRankCap(h, p, r, 0)) throw new Error(`${h} ${p} rank ${r} bonus ${b}`);
          }
        }
      }
    }
  });

  it("rank caps still cascade: an Eir with no officers fills a whole division with Crewmen", () => {
    const empty = { buckets: [], mode: "passive" as const };
    for (const p of CREW_PROFESSIONS) expect(remainingCapacityForSignature(empty, "eir", bucket(p, 1, 1)), p).toBe(divisionCap("eir", p));
  });
});

describe("CP-5 over cap (OC-6: never evict)", () => {
  it("an Eir full to the old 750 template absorbs pool crew up to 900 on its next fill (named in the patch notes)", () => {
    const old = withHullCrewCapsOff(() => fullCrewmen("eir"));
    expect(totalCrew(old)).toBe(750);
    const s = resolveCrew(withShip("eir", old, { crewPool: deepPool() }));
    const after = ship1(s).complement!.buckets;
    expect(totalCrew(after)).toBe(900);
    for (const p of CREW_PROFESSIONS) expect(countInDivision(after, p), p).toBeGreaterThanOrEqual(countInDivision(old, p));
  });

  it("an Aurora full to its old mix is over in three divisions: it keeps everyone, takes nothing there, and says so", () => {
    const old = withHullCrewCapsOff(() => fullCrewmen("aurora"));
    const over = complementOverCap(old, "aurora");
    expect(over.any).toBe(true);
    expect(over.totalOver).toBe(0);
    expect(over.divisionOver.security).toBe(15);
    expect(over.divisionOver.engineering).toBe(15);
    expect(over.divisionOver.medical).toBe(15);
    expect(over.divisions.science).toBe(0);
    expect(canAddToComplement({ buckets: old, mode: "passive" }, "aurora", bucket("security", 1, 1))).toBe(false);
    const s = resolveCrew(withShip("aurora", old, { crewPool: deepPool() }));
    const after = ship1(s).complement!.buckets;
    for (const p of CREW_PROFESSIONS) expect(countInDivision(after, p), p).toBeGreaterThanOrEqual(countInDivision(old, p));
    expect(countInDivision(after, "security")).toBe(countInDivision(old, "security"));
  });

  it("a quarters module coming off leaves the complement over its berths: nobody is removed, nothing is added", () => {
    const filled = autoCrewShip(deepPool(), "orion", { buckets: [], mode: "passive" }, 40).complement;
    expect(totalCrew(filled.buckets)).toBe(790);
    const over = complementOverCap(filled.buckets, "orion", 0);
    expect(over.totalOver).toBe(40);
    const again = autoCrewShip(deepPool(), "orion", filled, 0);
    expect(again.complement.buckets).toEqual(filled.buckets);
  });

  it("an over-cap rank reads as the division's excess: three Lt Commanders over the rank 8 seats", () => {
    const seats = commandStructureForHull("destroyer").divisions.security.rankAllocations[8];
    const over = complementOverCap([bucket("security", 8, seats + 3)], "destroyer");
    expect(over.divisions.security).toBe(3);
    expect(over.divisionOver.security).toBe(0);
    expect(over.totalOver).toBe(0);
    expect(over.any).toBe(true);
    expect(complementOverCap(fullCrewmen("destroyer"), "destroyer").any).toBe(false);
  });
});
