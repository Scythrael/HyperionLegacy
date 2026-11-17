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
  hullLeanDivisions,
  inclusiveRankCap,
  remainingCapacityForSignature,
} from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { autoCrewShip } from "./autoCrew";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { withHullCrewCapsOff } from "./hullCrewCapsSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

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

  it("the leans point where OC-5 says; a hull with an unchanged total leans by extra division seats (the total binds)", () => {
    const w = SHIP_TYPES.eir.complementDivisionWeights!;
    expect(CREW_PROFESSIONS.reduce((a, p) => a + w[p], 0)).toBeCloseTo(1, 9);
    for (const h of ["aurora", "carrier", "battleship"] as ShipTypeKey[]) {
      expect(complementTotalCap(h), h).toBe(withHullCrewCapsOff(() => complementTotalCap(h)));
      expect(CREW_PROFESSIONS.reduce((a, p) => a + divisionCap(h, p), 0), h).toBeGreaterThan(complementTotalCap(h));
    }
    expect(divisionCap("aurora", "science")).toBe(270);
    expect(divisionCap("carrier", "flightDeck")).toBe(56);
    expect(divisionCap("battleship", "security")).toBe(56);
    expect(divisionCap("battleship", "engineering")).toBe(48);
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

  // User 2026-11-02, "No division ever shrinks (Recommended)": every division of every hull keeps at least today's seats
  // (and every rank threshold inside it), with no quarters module and with one (bonus 1 to 200), so no existing ship
  // turns over cap from the new caps.
  it("no division ever shrinks: every hull, every division, every rank, bonus 0 to 200, new seats >= old seats", () => {
    for (const h of HULLS) {
      for (let b = 0; b <= 200; b++) {
        const before = withHullCrewCapsOff(() => commandStructureWithBonus(h, b));
        expect(complementTotalCap(h, b), `${h} total bonus ${b}`).toBeGreaterThanOrEqual(withHullCrewCapsOff(() => complementTotalCap(h, b)));
        for (const p of CREW_PROFESSIONS) {
          if (divisionCap(h, p, b) < before.divisions[p].cap) throw new Error(`${h} ${p} bonus ${b}: division shrank`);
          let old = 0;
          for (const r of [...CREW_RANK_ORDER].reverse()) {
            old += before.divisions[p].rankAllocations[r];
            if (inclusiveRankCap(h, p, r, b) < old) throw new Error(`${h} ${p} rank ${r} bonus ${b}: rank shrank`);
          }
        }
      }
    }
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

  it("no hull full to its old template turns over cap from the new caps (user 2026-11-02)", () => {
    for (const h of HULLS) {
      const old = withHullCrewCapsOff(() => fullCrewmen(h));
      expect(complementOverCap(old, h).any, h).toBe(false);
    }
  });

  it("an Aurora full to its old mix keeps everyone and has no room left: its 750 total binds", () => {
    const old = withHullCrewCapsOff(() => fullCrewmen("aurora"));
    expect(totalCrew(old)).toBe(750);
    expect(canAddToComplement({ buckets: old, mode: "passive" }, "aurora", bucket("science", 1, 1))).toBe(false);
    const s = resolveCrew(withShip("aurora", old, { crewPool: deepPool() }));
    expect(ship1(s).complement!.buckets).toEqual(old);
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

// User 2026-11-02, "Fill the lean division first (Recommended)": where a hull's division caps add up past its total, the
// lean is real in practice. Auto-crew (resolveCrew) and roster fills (autoCrewShip) seat SHIP_TYPES leanDivisions first.
describe("CP-5 lean fill order (leanDivisions)", () => {
  const LEANS: Partial<Record<ShipTypeKey, CrewProfession[]>> = {
    carrier: ["flightDeck"],
    battleship: ["security", "engineering"],
    aurora: ["science"],
    eir: ["medical", "science"],
  };
  const leanHulls = HULLS.filter((h) => SHIP_TYPES[h].leanDivisions !== undefined);

  it("the leans are per-hull data: Carrier Flight Deck; Battleship Security, then Engineering; Aurora Science; Eir Medical, then Science", () => {
    expect([...leanHulls].sort()).toEqual(Object.keys(LEANS).sort());
    for (const h of leanHulls) expect([...SHIP_TYPES[h].leanDivisions!], h).toEqual(LEANS[h]);
    expect(withHullCrewCapsOff(() => hullLeanDivisions("carrier"))).toEqual([]);
  });

  for (const h of Object.keys(LEANS) as ShipTypeKey[]) {
    it(`${h}: a normal full auto-fill reaches every seat of its lean division(s), and fills to its total`, () => {
      const s = resolveCrew(withShip(h, [], { crewPool: deepPool() }));
      const after = ship1(s).complement!.buckets;
      for (const p of LEANS[h]!) expect(countInDivision(after, p), `${h} ${p}`).toBe(divisionCap(h, p));
      expect(totalCrew(after), h).toBe(complementTotalCap(h));
    });
    it(`${h}: a roster / auto-crew fill with a quarters bonus (0, 12, 113) seats the lean division(s) to their caps`, () => {
      for (const b of [0, 12, 113]) {
        const { complement } = autoCrewShip(deepPool(), h, undefined, b);
        for (const p of LEANS[h]!) expect(countInDivision(complement.buckets, p), `${h} ${p} bonus ${b}`).toBe(divisionCap(h, p, b));
        expect(totalCrew(complement.buckets), `${h} bonus ${b}`).toBe(complementTotalCap(h, b));
      }
    });
  }

  it("the Carrier's lean is real: its divisions add up past 160, and the Flight Deck still seats all 56", () => {
    expect(CREW_PROFESSIONS.reduce((a, p) => a + divisionCap("carrier", p), 0)).toBeGreaterThan(complementTotalCap("carrier"));
    const { complement } = autoCrewShip(deepPool(), "carrier", undefined);
    expect(countInDivision(complement.buckets, "flightDeck")).toBe(56);
  });

  it("only the ORDER of new seats changes: crew already aboard are never moved or evicted", () => {
    for (const h of Object.keys(LEANS) as ShipTypeKey[]) {
      const old = withHullCrewCapsOff(() => fullCrewmen(h));
      const s = resolveCrew(withShip(h, old, { crewPool: deepPool() }));
      const after = ship1(s).complement!.buckets;
      for (const p of CREW_PROFESSIONS) expect(countInDivision(after, p), `${h} ${p}`).toBeGreaterThanOrEqual(countInDivision(old, p));
      expect(totalCrew(after), h).toBeGreaterThanOrEqual(totalCrew(old));
    }
  });
});
