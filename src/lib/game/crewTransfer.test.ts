// CP-7 (docs/plans/2026-10-14-complement-and-acquisition-plan.md, E-CREW Task 25 engine): TRANSFER.
// Covers: pool round trip and conservation (no crew created or destroyed); division, inclusive rank and total
// caps hold; partial fill reported per pick, picks applied in the given order; the target's assigned notables
// and its quarters capacity bonus counted; an over-cap target takes nothing and loses nothing (OC-6); locked
// ships and auto-crew ships refuse with the SAME reference (CP-6, OC-7); nothing moved is the same reference.
import { describe, it, expect } from "vitest";
import { freshState } from "./model";
import type {
  CaptainMissionState,
  CrewBucket,
  CrewProfession,
  EquipmentInstance,
  Expedition,
  GameState,
  NotableCrewMember,
} from "./model";
import {
  CREW_POOL,
  canTransferCrew,
  crewTransferBlockText,
  crewTransferGateText,
  crewTransferRoom,
  crewTransferShortfallText,
  transferCrew,
  type CrewTransferPick,
} from "./crewTransfer";
import { signatureKey, totalCrew } from "./crew";
import { CREW_RANK_ORDER } from "./crewRank";
import {
  CREW_PROFESSIONS,
  complementTotalCap,
  countAtRankOrHigher,
  countInDivision,
  divisionCap,
  inclusiveRankCap,
} from "./commandStructure";
import { quartersCapacityBonus } from "./crewModules";
import { resolveCrew } from "./crewOverlay";
import { emptyGroundTeams } from "./groundTeams";

// --- fixtures ---------------------------------------------------------------

const HULL = "generalFreighter" as const;

function bucket(profession: CrewProfession, count: number, rank: CrewBucket["rank"] = 1, buff1Id = `${profession}.b`): CrewBucket {
  return { profession, rarity: "standard", rank, race: "spacer", buff1Id, buff2Id: null, count };
}

function key(b: CrewBucket): string {
  return signatureKey(b);
}

// ship-1 (freshState's freighter, captain 1, idle) and ship-2 (a parked freighter), both MANUAL (active) and
// empty, with the given pool.
function fleet(pool: CrewBucket[] = []): GameState {
  const base = freshState();
  return {
    ...base,
    crewPool: pool,
    ships: [
      { ...base.ships[0], complement: { buckets: [], mode: "active" } },
      {
        id: "ship-2",
        typeKey: HULL,
        assignedCaptainId: null,
        complement: { buckets: [], mode: "active" },
        groundTeams: emptyGroundTeams(HULL),
      },
    ],
  };
}

function withComplement(s: GameState, shipId: string, buckets: CrewBucket[], mode: "active" | "passive" = "active"): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, complement: { buckets, mode } } : sh)) };
}

function shipBuckets(s: GameState, shipId: string): CrewBucket[] {
  return s.ships.find((sh) => sh.id === shipId)?.complement?.buckets ?? [];
}

function everyone(s: GameState): number {
  return totalCrew(s.crewPool) + s.ships.reduce((n, sh) => n + totalCrew(sh.complement?.buckets ?? []), 0);
}

function activeMission(): CaptainMissionState {
  return {
    kind: "extraction",
    missionKey: "shortOreRun",
    phase: "transitOut",
    phaseProgressTicks: 0,
    cargo: {} as CaptainMissionState["cargo"],
    recalled: false,
  };
}

// ship-1's captain out on a mission.
function onMission(s: GameState): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) };
}

// `shipId` on an expedition (the lock reads only the record's ship id).
function onExpedition(s: GameState, shipId: string, phase: Expedition["phase"] = "transit"): GameState {
  return { ...s, expeditions: [...s.expeditions, { id: `expedition-${shipId}`, shipId, phase } as unknown as Expedition] };
}

function notable(id: string, profession: CrewProfession, shipId: string | null): NotableCrewMember {
  return {
    id,
    profession,
    rarity: "standard",
    rank: 1,
    race: "spacer",
    buff1Id: `${profession}.b`,
    buff2Id: null,
    name: `Notable ${id}`,
    gender: "male",
    assignedShipId: shipId,
  };
}

function quartersOn(s: GameState, shipId: string, moduleVariant: string): GameState {
  const piece: EquipmentInstance = {
    id: `equip-quarters-${shipId}`,
    slotType: "quarters",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 1,
    blueprintKey: null,
    implicitStats: {},
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 110,
    fittedToShipId: shipId,
    moduleVariant,
  };
  return { ...s, equipment: [...s.equipment, piece] };
}

function expectWithinCaps(buckets: CrewBucket[], bonus = 0): void {
  expect(totalCrew(buckets)).toBeLessThanOrEqual(complementTotalCap(HULL, bonus));
  for (const p of CREW_PROFESSIONS) {
    expect(countInDivision(buckets, p)).toBeLessThanOrEqual(divisionCap(HULL, p));
    for (const r of CREW_RANK_ORDER) {
      expect(countAtRankOrHigher(buckets, p, r)).toBeLessThanOrEqual(inclusiveRankCap(HULL, p, r));
    }
  }
}

// --- moves --------------------------------------------------------------------

describe("transferCrew: moves bulk between the pool and manual ships (CP-7)", () => {
  it("pool to ship moves the requested count, and nothing is created or destroyed", () => {
    const ops = bucket("operations", 20);
    const s = fleet([ops]);
    const out = transferCrew(s, CREW_POOL, "ship-1", [{ signatureKey: key(ops), count: 4 }]);
    expect(out.gate.ok).toBe(true);
    expect(out.moved).toBe(4);
    expect(out.results).toEqual([{ signatureKey: key(ops), requested: 4, moved: 4, limitedBy: null }]);
    expect(totalCrew(shipBuckets(out.next, "ship-1"))).toBe(4);
    expect(totalCrew(out.next.crewPool)).toBe(16);
    expect(everyone(out.next)).toBe(everyone(s));
    // The mode stays manual; the input is never mutated.
    expect(out.next.ships[0].complement?.mode).toBe("active");
    expect(totalCrew(s.crewPool)).toBe(20);
    expect(shipBuckets(s, "ship-1")).toEqual([]);
  });

  it("pool round trip: out to a ship and back leaves the pool as it was", () => {
    const ops = bucket("operations", 6);
    const sec = bucket("security", 2, 1, "sec.boarding");
    const s = fleet([ops, sec]);
    const there = transferCrew(s, CREW_POOL, "ship-1", [
      { signatureKey: key(ops), count: 6 },
      { signatureKey: key(sec), count: 2 },
    ]).next;
    expect(there.crewPool).toEqual([]);
    const back = transferCrew(there, "ship-1", CREW_POOL, [
      { signatureKey: key(ops), count: 6 },
      { signatureKey: key(sec), count: 2 },
    ]).next;
    expect(shipBuckets(back, "ship-1")).toEqual([]);
    expect(back.crewPool).toEqual([ops, sec]);
  });

  it("ship to ship moves between two manual ships", () => {
    const eng = bucket("engineering", 4);
    const s = withComplement(fleet(), "ship-1", [eng]);
    const out = transferCrew(s, "ship-1", "ship-2", [{ signatureKey: key(eng), count: 3 }]);
    expect(out.moved).toBe(3);
    expect(totalCrew(shipBuckets(out.next, "ship-1"))).toBe(1);
    expect(totalCrew(shipBuckets(out.next, "ship-2"))).toBe(3);
    expect(everyone(out.next)).toBe(everyone(s));
  });

  it("the pool has no cap: a full ship empties into it", () => {
    const ops = bucket("operations", divisionCap(HULL, "operations"));
    const s = withComplement(fleet([bucket("operations", 500)]), "ship-1", [ops]);
    const out = transferCrew(s, "ship-1", CREW_POOL, [{ signatureKey: key(ops), count: ops.count }]);
    expect(out.moved).toBe(ops.count);
    expect(totalCrew(out.next.crewPool)).toBe(500 + ops.count);
  });
});

// --- caps -----------------------------------------------------------------------

describe("transferCrew: cap-aware per pick, partial and reported (CP-7)", () => {
  it("the division cap holds: a big request fills the division and reports targetFull", () => {
    const ops = bucket("operations", 100);
    const out = transferCrew(fleet([ops]), CREW_POOL, "ship-1", [{ signatureKey: key(ops), count: 100 }]);
    const cap = divisionCap(HULL, "operations");
    expect(out.moved).toBe(cap);
    expect(out.results[0]).toEqual({ signatureKey: key(ops), requested: 100, moved: cap, limitedBy: "targetFull" });
    expect(totalCrew(out.next.crewPool)).toBe(100 - cap);
    expectWithinCaps(shipBuckets(out.next, "ship-1"));
  });

  it("the inclusive rank cap holds for senior crew", () => {
    // A freighter has few Chief-and-above operations berths; a large rank-3 request fills only those.
    const senior = bucket("operations", 50, 3);
    const out = transferCrew(fleet([senior]), CREW_POOL, "ship-1", [{ signatureKey: key(senior), count: 50 }]);
    const cap = inclusiveRankCap(HULL, "operations", 3);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(divisionCap(HULL, "operations"));
    expect(out.moved).toBe(cap);
    expect(out.results[0].limitedBy).toBe("targetFull");
    expectWithinCaps(shipBuckets(out.next, "ship-1"));
  });

  it("picks apply in the given order: an earlier pick claims the shared rank room first", () => {
    // Rank 2 and rank 1 operations share the division; asking rank 1 first leaves rank 2 nothing.
    const low = bucket("operations", 100, 1);
    const high = bucket("operations", 100, 2);
    const lowFirst = transferCrew(fleet([low, high]), CREW_POOL, "ship-1", [
      { signatureKey: key(low), count: 100 },
      { signatureKey: key(high), count: 100 },
    ]);
    expect(lowFirst.results[0].moved).toBe(divisionCap(HULL, "operations"));
    expect(lowFirst.results[1]).toEqual({ signatureKey: key(high), requested: 100, moved: 0, limitedBy: "targetFull" });
    const highFirst = transferCrew(fleet([low, high]), CREW_POOL, "ship-1", [
      { signatureKey: key(high), count: 100 },
      { signatureKey: key(low), count: 100 },
    ]);
    expect(highFirst.results[0].moved).toBe(inclusiveRankCap(HULL, "operations", 2));
    expect(highFirst.results[0].moved + highFirst.results[1].moved).toBe(divisionCap(HULL, "operations"));
    expectWithinCaps(shipBuckets(highFirst.next, "ship-1"));
  });

  it("the source running short reports sourceShort; a key the source lacks moves nothing", () => {
    const ops = bucket("operations", 3);
    const sec = bucket("security", 1);
    const out = transferCrew(fleet([ops]), CREW_POOL, "ship-1", [
      { signatureKey: key(ops), count: 5 },
      { signatureKey: key(sec), count: 1 },
    ]);
    expect(out.results).toEqual([
      { signatureKey: key(ops), requested: 5, moved: 3, limitedBy: "sourceShort" },
      { signatureKey: key(sec), requested: 1, moved: 0, limitedBy: "sourceShort" },
    ]);
    expect(out.moved).toBe(3);
  });

  it("the target's assigned notables hold their slots (the applyRoster occupancy rule)", () => {
    const sec = bucket("security", 50);
    const cap = divisionCap(HULL, "security");
    const s = { ...fleet([sec]), notableCrew: [notable("notable-1", "security", "ship-1"), notable("notable-2", "security", null)] };
    const out = transferCrew(s, CREW_POOL, "ship-1", [{ signatureKey: key(sec), count: 50 }]);
    expect(out.moved).toBe(cap - 1);
    // Bulk plus the assigned notable sits exactly at the cap.
    expect(countInDivision(shipBuckets(out.next, "ship-1"), "security") + 1).toBe(cap);
    // The unassigned notable is not counted; notables never move.
    expect(out.next.notableCrew).toBe(s.notableCrew);
  });

  it("the target's quarters capacity bonus raises the total room", () => {
    // Saturate ship-1 at its base TOTAL with operations one short of its division cap.
    const prefill: CrewBucket[] = [
      bucket("operations", divisionCap(HULL, "operations") - 1),
      bucket("flightDeck", divisionCap(HULL, "flightDeck")),
      bucket("engineering", divisionCap(HULL, "engineering")),
      bucket("security", divisionCap(HULL, "security")),
      bucket("science", divisionCap(HULL, "science")),
      bucket("medical", divisionCap(HULL, "medical")),
    ];
    const extra = bucket("operations", 10, 2);
    const s = withComplement(fleet([extra]), "ship-1", prefill);
    const pick: CrewTransferPick[] = [{ signatureKey: key(extra), count: 10 }];
    const baseRoom = complementTotalCap(HULL) - totalCrew(prefill);
    const plain = transferCrew(s, CREW_POOL, "ship-1", pick);
    expect(plain.moved).toBe(Math.max(0, Math.min(1, baseRoom)));
    const eff = quartersOn(s, "ship-1", "quartersEfficient");
    const bonus = quartersCapacityBonus(eff, eff.ships[0]);
    expect(bonus).toBeGreaterThan(0);
    const roomy = transferCrew(eff, CREW_POOL, "ship-1", pick);
    expect(roomy.moved).toBe(1); // the division's last seat, now that the total has room
    expect(roomy.moved).toBeGreaterThanOrEqual(plain.moved);
    expectWithinCaps(shipBuckets(roomy.next, "ship-1"), bonus);
  });

  it("an over-cap target takes no more and loses nobody (OC-6 never evict)", () => {
    const over = bucket("security", divisionCap(HULL, "security") + 5);
    const more = bucket("security", 10, 1, "sec.boarding");
    const s = withComplement(fleet([more]), "ship-1", [over]);
    const out = transferCrew(s, CREW_POOL, "ship-1", [{ signatureKey: key(more), count: 10 }]);
    expect(out.moved).toBe(0);
    expect(out.results[0].limitedBy).toBe("targetFull");
    expect(out.next).toBe(s); // nothing moved: same reference
    // Taking crew OFF the over-cap ship still works.
    const off = transferCrew(s, "ship-1", CREW_POOL, [{ signatureKey: key(over), count: 2 }]);
    expect(off.moved).toBe(2);
  });

  it("crewTransferRoom previews the most a pick could move", () => {
    const ops = bucket("operations", 100);
    const s = fleet([ops]);
    expect(crewTransferRoom(s, CREW_POOL, "ship-1", key(ops))).toBe(divisionCap(HULL, "operations"));
    expect(crewTransferRoom(s, "ship-1", CREW_POOL, key(ops))).toBe(0);
    expect(crewTransferRoom(onMission(s), CREW_POOL, "ship-1", key(ops))).toBe(0);
  });
});

// --- refusals -----------------------------------------------------------------

describe("transferCrew: refusals are typed and same-reference (CP-6 lock, OC-7 manual only)", () => {
  const ops = bucket("operations", 10);
  const pick: CrewTransferPick[] = [{ signatureKey: key(ops), count: 2 }];

  it("a crew-locked ship refuses on either side, mission or expedition, and works once free", () => {
    const base = withComplement(fleet([ops]), "ship-2", [ops]);
    const cases: [GameState, string, string, string][] = [
      [onMission(base), CREW_POOL, "ship-1", "Ship is out on a mission"],
      [onMission(base), "ship-1", CREW_POOL, "Ship is out on a mission"],
      [onExpedition(base, "ship-2"), "ship-2", "ship-1", "Ship is on an expedition"],
      [onExpedition(base, "ship-2", "complete"), CREW_POOL, "ship-2", "Ship is on an expedition"],
    ];
    for (const [s, from, to, text] of cases) {
      const out = transferCrew(s, from, to, pick);
      expect(out.next).toBe(s);
      expect(out.results).toEqual([]);
      expect(out.gate).toMatchObject({ ok: false, reason: "onMission" });
      expect(crewTransferGateText(s, out.gate)).toBe(text);
    }
    expect(transferCrew(base, "ship-2", "ship-1", pick).moved).toBe(2);
  });

  it("an auto-crew ship refuses on either side (manual ships only), and a fresh ship reads as auto", () => {
    const s = withComplement(fleet([ops]), "ship-1", [ops], "passive");
    for (const [from, to] of [[CREW_POOL, "ship-1"], ["ship-1", "ship-2"], ["ship-2", "ship-1"]] as const) {
      const out = transferCrew(s, from, to, pick);
      expect(out.next).toBe(s);
      expect(out.gate).toEqual({ ok: false, reason: "autoCrew", shipId: "ship-1" });
    }
    const fresh = { ...s, ships: s.ships.map((sh) => (sh.id === "ship-2" ? { ...sh, complement: undefined } : sh)) };
    expect(canTransferCrew(fresh, CREW_POOL, "ship-2", pick)).toEqual({ ok: false, reason: "autoCrew", shipId: "ship-2" });
    expect(crewTransferGateText(s, transferCrew(s, CREW_POOL, "ship-1", pick).gate)).toBe("Switch the ship to manual crew first");
  });

  it("a lock outranks auto-crew, and the source is named before the target", () => {
    const s = onMission(withComplement(fleet([ops]), "ship-2", [], "passive"));
    expect(canTransferCrew(s, "ship-2", "ship-1", pick)).toEqual({ ok: false, reason: "onMission", shipId: "ship-1" });
    expect(canTransferCrew(fleet(), "ship-missing", "ship-1", pick)).toEqual({ ok: false, reason: "noShip", shipId: "ship-missing" });
  });

  it("same endpoint, a missing ship and bad picks refuse", () => {
    const s = fleet([ops]);
    expect(canTransferCrew(s, CREW_POOL, CREW_POOL, pick)).toEqual({ ok: false, reason: "sameEndpoint" });
    expect(canTransferCrew(s, "ship-1", "ship-1", pick)).toEqual({ ok: false, reason: "sameEndpoint" });
    expect(canTransferCrew(s, CREW_POOL, "ship-9", pick)).toEqual({ ok: false, reason: "noShip", shipId: "ship-9" });
    for (const bad of [[], [{ signatureKey: key(ops), count: 0 }], [{ signatureKey: key(ops), count: 1.5 }], [{ signatureKey: key(ops), count: -2 }]]) {
      const out = transferCrew(s, CREW_POOL, "ship-1", bad);
      expect(out.gate).toEqual({ ok: false, reason: "noPicks" });
      expect(out.next).toBe(s);
    }
  });

  it("every reason and shortfall has player text", () => {
    for (const r of ["noPicks", "sameEndpoint", "noShip", "onMission", "autoCrew"] as const) {
      expect(crewTransferBlockText(r).length).toBeGreaterThan(0);
    }
    expect(crewTransferShortfallText("targetFull")).toContain("room");
    expect(crewTransferShortfallText("sourceShort")).toContain("available");
    expect(crewTransferGateText(fleet(), { ok: true })).toBeUndefined();
  });

  it("the tick's auto-crew never touches a manual ship's transferred crew", () => {
    // A transferred-to manual ship keeps exactly what it got across a crew resolve (active mode is untouched).
    const s = fleet([bucket("operations", 20)]);
    const out = transferCrew(s, CREW_POOL, "ship-1", [{ signatureKey: key(bucket("operations", 1)), count: 5 }]).next;
    const after = resolveCrew(out);
    expect(totalCrew(shipBuckets(after, "ship-1"))).toBe(5);
  });
});
