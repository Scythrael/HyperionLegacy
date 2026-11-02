// Complement plan CP-5 (per-hull crew caps, docs/plans/2026-10-14-complement-and-acquisition-plan.md section 3 CP-5):
// golden hashes captured on the code BEFORE the per-hull caps (on top of 673cba2). Whole derived records, never a
// narrow subset:
//
//   structure : commandStructureWithBonus for every hull at bonus 0 (the cached template) and at the quarters bonuses
//               a ship can carry (6 wings, 12 Utilitarian, 40 Efficient, 113 a large Crew Stations line on top).
//   fill      : one passive, empty ship of every hull auto-crewed by resolveCrew from a deep pool holding every
//               division at every rank: the ship's complement and the pool left behind.
//   transfer  : the CP-7 transfer engine moving 1,000 of each division's Crewmen from the pool to an empty manual ship
//               of every hull: the per-pick results.
//   overCap   : an Aurora and an Orion whose complements sit OVER their caps (the total, a division and a rank), run
//               600 s across a transport window as one call, as 1 s steps and in uneven chunks: the three paths agree,
//               no crew is ever removed, and the final state is pinned.
//
// The structure pins of every hull CP-5 gives no override must never move; the rest move only with CP-5 and are
// traced back by switching it off.

import { describe, expect, it } from "vitest";
import { freshState, SHIP_TYPES, type CrewBucket, type CrewProfession, type CrewRank, type GameState, type ShipTypeKey } from "./model";
import { CREW_PROFESSIONS, commandStructureWithBonus, countInDivision } from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";
import { CREW_PROFESSION_BUFFS } from "./crewBuffs";
import { CREW_RACE_IDS } from "./crewRaces";
import { resolveCrew } from "./crewOverlay";
import { CREW_POOL, transferCrew } from "./crewTransfer";
import { signatureKey, totalCrew } from "./crew";
import { tick } from "./tick";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { goldenJson, fnv } from "./firstRunsGoldens.fixture";
import { withHullCrewCapsOff } from "./hullCrewCapsSwitch.fixture";

const hash = (v: unknown): string => fnv(goldenJson(v));
const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const BONUSES = [0, 6, 12, 40, 113];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A bucket of `count` crew of one signature (the first buff of the division's pool, a fixed race per rank).
function bucket(profession: CrewProfession, rank: CrewRank, count: number): CrewBucket {
  return {
    profession,
    rarity: "standard",
    rank,
    race: CREW_RACE_IDS[rank % CREW_RACE_IDS.length],
    buff1Id: CREW_PROFESSION_BUFFS[profession][0].id,
    buff2Id: null,
    count,
  };
}

// A deep pool: every division at every rank, 400 of each (more than any hull can take).
function deepPool(): CrewBucket[] {
  const out: CrewBucket[] = [];
  for (const p of CREW_PROFESSIONS) for (const r of CREW_RANK_ORDER) out.push(bucket(p, r, 400));
  return out;
}

// ship-1 re-hulled to `hull` with `buckets` aboard in `mode`.
function withShip(hull: ShipTypeKey, buckets: CrewBucket[], mode: "passive" | "active", over: Partial<GameState> = {}): GameState {
  const base = freshState();
  return {
    ...base,
    ...over,
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull, complement: { buckets, mode } } : sh)),
  };
}

export function structureRows(): string[] {
  return HULLS.map((h) => `${h}:${BONUSES.map((b) => hash(commandStructureWithBonus(h, b))).join("/")}`);
}

export function fillRows(): string[] {
  return HULLS.map((h) => {
    const s = resolveCrew(withShip(h, [], "passive", { crewPool: deepPool() }));
    const ship = s.ships.find((sh) => sh.id === "ship-1")!;
    return `${h}:${totalCrew(ship.complement!.buckets)}:${hash(ship.complement)}/${hash(s.crewPool)}`;
  });
}

export function transferRows(): string[] {
  return HULLS.map((h) => {
    const s = withShip(h, [], "active", { crewPool: deepPool() });
    const picks = CREW_PROFESSIONS.map((p) => ({ signatureKey: signatureKey(bucket(p, 1, 1)), count: 1000 }));
    const r = transferCrew(s, CREW_POOL, "ship-1", picks);
    return `${h}:${r.moved}:${hash(r.results)}`;
  });
}

// Over its caps on every axis: 30 more crew than the hull's total, a Security division 40 over, and three Lt
// Commanders more than the Security rank 8 allocation.
export function overCapComplement(hull: ShipTypeKey): CrewBucket[] {
  const t = commandStructureWithBonus(hull, 0);
  const buckets: CrewBucket[] = [];
  const secCap = t.divisions.security.cap;
  buckets.push(bucket("security", 8, t.divisions.security.rankAllocations[8] + 3));
  buckets.push(bucket("security", 1, secCap + 40 - buckets[0].count));
  let left = t.total + 30 - totalCrew(buckets);
  for (const p of CREW_PROFESSIONS) {
    if (p === "security") continue;
    const n = Math.min(left, t.divisions[p].cap);
    buckets.push(bucket(p, 1, n));
    left -= n;
  }
  if (left > 0) buckets.push(bucket("engineering", 2, left));
  return buckets;
}

const OVER_START = TRANSPORT_WINDOW_SECONDS - 100;
const OVER_SPAN = 600;

function overCapStart(hull: ShipTypeKey, buckets: CrewBucket[]): GameState {
  return withShip(hull, buckets, "passive", { gameTimeSeconds: OVER_START });
}

// One call, 1 s steps, and uneven chunks over the same span on one rng stream each.
export function overCapPaths(hull: ShipTypeKey, buckets: CrewBucket[]): { one: GameState; steps: GameState; chunks: GameState } {
  const one = tick(OVER_SPAN, overCapStart(hull, buckets), lcg(0xc95));
  let steps = overCapStart(hull, buckets);
  const r2 = lcg(0xc95);
  for (let i = 0; i < OVER_SPAN; i++) steps = tick(1, steps, r2);
  let chunks = overCapStart(hull, buckets);
  const r3 = lcg(0xc95);
  for (const c of [7, 93, 1, 250, 49, 200]) chunks = tick(c, chunks, r3);
  return { one, steps, chunks };
}

export function overCapRow(hull: ShipTypeKey, buckets: CrewBucket[] = overCapComplement(hull)): string {
  const { one } = overCapPaths(hull, buckets);
  const ship = one.ships.find((sh) => sh.id === "ship-1")!;
  return `${hull}:${totalCrew(ship.complement!.buckets)}:${hash(ship.complement)}/${hash(one.crewPool)}`;
}

// ===== the pins (captured before CP-5, on top of 673cba2) =====

export const STRUCTURE_PRE: string[] = [
  "generalFreighter:ac349d1e/f1520a87/16d3ee03/787feb30/5151622a",
  "prospectorHauler:a9a20003/b15227bd/4acb7888/f9a6b21f/ce0fa96",
  "prospectorRunner:b82077fa/9db3aeb0/44c52a15/f120ab76/7f4dab2d",
  "prospectorMiner:f285bac1/66f8247f/819c267a/7ac2c139/9c95a8d8",
  "destroyer:8b4ebedb/38889198/b9969340/22ea36a3/b882c978",
  "battleship:3c0554b6/773fbd5d/7a798d76/86de3488/69a1ec4e",
  "carrier:78e25e1c/149c594f/30b59514/692d1566/2c708800",
  "orion:25054271/a852709b/4ffc9d84/ee03209c/ecb6dfa8",
  "aurora:96401abe/667ff564/4a850c63/a811a6a1/111d3621",
  "eir:d1e1aaac/4b9e50ae/16cd1c41/6b931c0b/6e8e96e7",
];
export const FILL_PRE: string[] = [
  "generalFreighter:30:6e2d2783/8dd63f97",
  "prospectorHauler:50:ae8d5b91/832a2cbb",
  "prospectorRunner:50:ae8d5b91/832a2cbb",
  "prospectorMiner:50:ae8d5b91/832a2cbb",
  "destroyer:120:94235d9a/663d8135",
  "battleship:160:4f232a0a/d375b89d",
  "carrier:160:4f232a0a/d375b89d",
  "orion:750:eef22fbc/948ce6ae",
  "aurora:750:eef22fbc/948ce6ae",
  "eir:750:eef22fbc/948ce6ae",
];
export const TRANSFER_PRE: string[] = [
  "generalFreighter:30:f7f65eff",
  "prospectorHauler:50:c7f24e58",
  "prospectorRunner:50:c7f24e58",
  "prospectorMiner:50:c7f24e58",
  "destroyer:120:54d83a47",
  "battleship:160:b6adc036",
  "carrier:160:b6adc036",
  "orion:750:498d6c1d",
  "aurora:750:498d6c1d",
  "eir:750:498d6c1d",
];
export const OVER_CAP_PRE: Record<string, string> = {
  aurora: "aurora:780:4dfc6770/d37aa99c",
  orion: "orion:780:4dfc6770/d37aa99c",
};

// The over-cap pins' starting complements are built from the hull's template, so each is built with CP-5 off to
// reproduce its capture (the template moved for the Aurora).
const overCapPre = (hull: ShipTypeKey): CrewBucket[] => withHullCrewCapsOff(() => overCapComplement(hull));

describe("CP-5 goldens (captured before the per-hull caps)", () => {
  // With CP-5 switched off every pin returns: the per-hull caps are the only thing CP-5 moved here.
  it("structure: every hull at bonus 0, 6, 12, 40, 113 (CP-5 off)", () => {
    expect(withHullCrewCapsOff(structureRows)).toEqual(STRUCTURE_PRE);
  });
  it("fill: a passive empty ship of every hull auto-crewed from a deep pool (CP-5 off)", () => {
    expect(withHullCrewCapsOff(fillRows)).toEqual(FILL_PRE);
  });
  it("transfer: 1,000 Crewmen of each division to an empty manual ship of every hull (CP-5 off)", () => {
    expect(withHullCrewCapsOff(transferRows)).toEqual(TRANSFER_PRE);
  });
  for (const hull of ["aurora", "orion"] as ShipTypeKey[]) {
    it(`overCap ${hull}: one call == 1 s steps == chunks, nobody removed, pinned (CP-5 off)`, () => {
      withHullCrewCapsOff(() => {
        const buckets = overCapComplement(hull);
        const { one, steps, chunks } = overCapPaths(hull, buckets);
        expect(goldenJson(steps)).toBe(goldenJson(one));
        expect(goldenJson(chunks)).toBe(goldenJson(one));
        const after = one.ships.find((sh) => sh.id === "ship-1")!.complement!.buckets;
        for (const p of CREW_PROFESSIONS) expect(countInDivision(after, p), p).toBeGreaterThanOrEqual(countInDivision(buckets, p));
        expect(totalCrew(after)).toBeGreaterThanOrEqual(totalCrew(buckets));
        expect(overCapRow(hull, buckets)).toBe(OVER_CAP_PRE[hull]);
      });
    });
  }
});

// ===== CP-5 live (re-pinned on the wiring commit) =====

// The hulls CP-5 gives their own caps (SHIP_TYPES complementCap / complementDivisionWeights). Every other hull's rows
// must equal its pre-CP-5 row byte for byte.
const OVERRIDDEN: ReadonlySet<ShipTypeKey> = new Set<ShipTypeKey>(["battleship", "carrier", "aurora", "eir"]);
const swap = (pre: string[], post: Record<string, string>): string[] => pre.map((row) => post[row.slice(0, row.indexOf(":"))] ?? row);

// Moved by CP-5 (each returns to its PRE row with CP-5 off, above): the four overridden hulls' templates, what an
// empty passive ship of each takes from the deep pool (the Eir 900, the leans), and what a transfer moves.
export const STRUCTURE_POST = swap(STRUCTURE_PRE, {
  battleship: "battleship:ff825651/4f209936/e8d16144/defd789a/86475590",
  carrier: "carrier:b3c2f324/8e4cfc82/f9fcbbca/f1e44531/3a7deccc",
  aurora: "aurora:bae5c035/90dc8b6c/9a85cfdf/bd7a37ef/c877d841",
  eir: "eir:a9fc80f7/36ff4102/9e83e9a3/e0536ab8/8dafbb53",
});
export const FILL_POST = swap(FILL_PRE, {
  battleship: "battleship:160:9d09a236/ad7eae69",
  carrier: "carrier:160:ae006845/c3fc4be3",
  aurora: "aurora:750:5f7a38d4/7eb82775",
  eir: "eir:900:4b33ff58/20add6cc",
});
export const TRANSFER_POST = swap(TRANSFER_PRE, {
  battleship: "battleship:160:9e051c01",
  carrier: "carrier:160:805b23c0",
  aurora: "aurora:750:7bc031bc",
  eir: "eir:900:94cc5e5",
});
// The pre-CP-5 over-cap complements run with CP-5 live: byte-identical to their capture. Both are over their total, so
// neither takes the transport's crew, and nobody is removed (the Aurora's start is now further over in Security too).
export const OVER_CAP_POST: Record<string, string> = { ...OVER_CAP_PRE };

describe("CP-5 live: per-hull crew caps", () => {
  it("every hull without an override is byte-identical; the four with one moved", () => {
    expect(OVERRIDDEN.size).toBe(HULLS.filter((h) => SHIP_TYPES[h].complementCap !== undefined || SHIP_TYPES[h].complementDivisionWeights !== undefined).length);
    for (const h of HULLS) if (!OVERRIDDEN.has(h)) expect(SHIP_TYPES[h].complementCap ?? SHIP_TYPES[h].complementDivisionWeights, h).toBeUndefined();
    const rows = structureRows();
    HULLS.forEach((h, i) => (OVERRIDDEN.has(h) ? expect(rows[i], h).not.toBe(STRUCTURE_PRE[i]) : expect(rows[i], h).toBe(STRUCTURE_PRE[i])));
  });
  it("structure", () => {
    expect(structureRows()).toEqual(STRUCTURE_POST);
  });
  it("fill: the Eir auto-crews 900, every hull fills to its own total", () => {
    expect(fillRows()).toEqual(FILL_POST);
  });
  it("transfer", () => {
    expect(transferRows()).toEqual(TRANSFER_POST);
  });
  for (const hull of ["aurora", "orion"] as ShipTypeKey[]) {
    it(`overCap ${hull}: an old save over its caps keeps every crewmember; one call == 1 s steps == chunks`, () => {
      const buckets = overCapPre(hull);
      const { one, steps, chunks } = overCapPaths(hull, buckets);
      expect(goldenJson(steps)).toBe(goldenJson(one));
      expect(goldenJson(chunks)).toBe(goldenJson(one));
      const after = one.ships.find((sh) => sh.id === "ship-1")!.complement!.buckets;
      for (const p of CREW_PROFESSIONS) expect(countInDivision(after, p), p).toBeGreaterThanOrEqual(countInDivision(buckets, p));
      expect(totalCrew(after)).toBeGreaterThanOrEqual(totalCrew(buckets));
      expect(overCapRow(hull, buckets)).toBe(OVER_CAP_POST[hull]);
    });
  }
});
