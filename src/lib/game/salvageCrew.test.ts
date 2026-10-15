// CP-6 core (docs/plans/2026-10-14-complement-and-acquisition-plan.md): salvaging a hull never strands an
// expedition or the people aboard. A hull on an expedition (in flight, or complete but unclaimed) refuses with
// `shipOnExpedition` on every salvage path (the instant salvageShip, the queued-order gates); a successful
// salvage releases everyone aboard ATOMICALLY (away members and officers and notables unassigned, the
// complement back to the crew pool, a ground team loadout worn on the hull checked back in), and the v68 -> v69
// migration repairs saves that already hold ids pointing at a removed hull.
import { describe, it, expect } from "vitest";
import {
  salvageShip,
  salvageShipLockReason,
  salvageShipPeople,
  salvageShipPeopleText,
} from "./salvage";
import { canStartSalvage, canStartAutoSalvage, resolveProcesses } from "./tick";
import { freshState } from "./model";
import type {
  CrewBucket,
  EquipmentInstance,
  Expedition,
  GameState,
  GroundTeamLoadout,
  NotableCrewMember,
  QueuedOrder,
  SeniorStaffOfficer,
} from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates, orphanExpeditions, startExpedition } from "./expedition";
import { asLegacyDispatch, plainAwayMember, withMinimumAwayTeam } from "./awayTeamTestFixtures";
import { emptyGroundTeams, shipGroundTeams } from "./groundTeams";
import { migrate, serialize, deserialize, repairOrphanedShipRefsV69, SAVE_VERSION, type SaveFile } from "./save";
import { totalCrew } from "./crew";

const SEC: CrewBucket = { profession: "security", rarity: "standard", rank: 1, race: "earthBorn", buff1Id: "sec.boarding", buff2Id: null, count: 0 };
const SCI: CrewBucket = { profession: "science", rarity: "standard", rank: 4, race: "vael", buff1Id: "sci.survey", buff2Id: null, count: 0 };

function officer(id: string, shipId: string | null): SeniorStaffOfficer {
  return {
    id,
    seat: "pilot",
    name: `Officer ${id}`,
    race: "earthBorn",
    gender: "female",
    rank: "ensign",
    bonuses: [{ id: "b1", magnitude: 1 }, { id: "b2", magnitude: 2 }],
    missionsCompleted: 0,
    assignedShipId: shipId,
  };
}

function notable(id: string, shipId: string | null): NotableCrewMember {
  return {
    id,
    profession: "security",
    rarity: "standard",
    rank: 2,
    race: "earthBorn",
    buff1Id: "sec.boarding",
    buff2Id: null,
    name: `Notable ${id}`,
    gender: "male",
    assignedShipId: shipId,
  };
}

// A worn member piece (only the fields salvage reads matter here).
function wornPiece(id: string, memberId: string, committedTo?: string): EquipmentInstance {
  const base = freshState().equipment[0];
  return {
    ...base,
    id,
    fittedToShipId: null,
    fittedToMemberId: memberId,
    ...(committedTo !== undefined ? { committedToLoadoutId: committedTo } : {}),
  } as EquipmentInstance;
}

// Two hulls: ship-1 (captain 1, idle) carries a complement, two away members (slotted), one officer, one
// notable, a worn ground team loadout; ship-2 is a parked freighter with its own officer and member.
function crewedFleet(): GameState {
  const base = freshState();
  let s: GameState = {
    ...base,
    ships: [
      { ...base.ships[0], complement: { buckets: [{ ...SEC, count: 10 }, { ...SCI, count: 2 }], mode: "passive" } },
      { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null, groundTeams: emptyGroundTeams("generalFreighter") },
    ],
    crewPool: [{ ...SEC, count: 5 }],
  };
  s = withMinimumAwayTeam(s, "ship-1"); // member-N (security) + member-N+1 (science), slotted on ship-1
  const [m1, m2] = s.awayMembers.slice(-2).map((m) => m.id);
  const loadout: GroundTeamLoadout = { id: "squad-1", name: "Kit", security: [], science: [], checkedOutTo: { shipId: "ship-1", teamIndex: 0 } };
  return {
    ...s,
    awayMembers: [...s.awayMembers, plainAwayMember("member-90", "security", "ship-2")],
    officers: [officer("officer-1", "ship-1"), officer("officer-2", "ship-2"), officer("officer-3", null)],
    notableCrew: [notable("notable-1", "ship-1"), notable("notable-2", null)],
    equipment: [...s.equipment, wornPiece("own-1", m1), wornPiece("kit-1", m2, "squad-1")],
    squadLoadouts: [loadout],
  };
}

function shipOrder(shipId: string): QueuedOrder {
  return { type: "salvage", target: { kind: "ship", shipId }, mode: { kind: "batch", remaining: 1 } };
}

// A fleet whose ship-1 is out on a REAL expedition (startExpedition, the console's dispatch). Launched as a
// legacy run (no ground ops) so advanceExpedition alone carries it to "complete" for the claim cases.
function onExpedition(): GameState {
  const s = crewedFleet();
  const launched = asLegacyDispatch(startExpedition(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  expect(launched.success).toBe(true);
  return launched.next;
}

describe("salvage refuses a hull on an expedition (CP-6)", () => {
  it("an in-flight expedition: salvageShip refuses with shipOnExpedition, same reference", () => {
    const s = onExpedition();
    expect(s.expeditions[0].phase).not.toBe("complete");
    const r = salvageShip(s, "ship-1", () => 0.5);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("shipOnExpedition");
    expect(r.next).toBe(s);
    expect(salvageShipLockReason(s, "ship-1")).toBe("shipOnExpedition");
  });

  it("a COMPLETE but unclaimed expedition still refuses (its findings and away team wait on the claim)", () => {
    const s = onExpedition();
    const done: GameState = { ...s, expeditions: [advanceExpedition(s.expeditions[0], 10_000_000)] };
    expect(done.expeditions[0].phase).toBe("complete");
    const r = salvageShip(done, "ship-1", () => 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("shipOnExpedition");
  });

  it("the queued-order gates (manual lanes and the automation's) wait with the same reason, never deleting", () => {
    const s = onExpedition();
    expect(canStartSalvage(s, shipOrder("ship-1"))).toEqual({ ok: false, reason: "shipOnExpedition" });
    expect(canStartAutoSalvage(s, shipOrder("ship-1"))).toEqual({ ok: false, reason: "shipOnExpedition" });
  });

  it("after the claim the hull salvages normally", () => {
    const s = onExpedition();
    const exp = advanceExpedition(s.expeditions[0], 10_000_000);
    const claimed = claimExpedition({ ...s, expeditions: [exp] }, exp.id);
    expect(claimed.success).toBe(true);
    expect(salvageShipLockReason(claimed.next, "ship-1")).toBeNull();
    expect(salvageShip(claimed.next, "ship-1", () => 0.5).ok).toBe(true);
  });

  it("a mission still reports shipOnMission first (the recall-first reason)", () => {
    const s = crewedFleet();
    const flying: GameState = {
      ...s,
      captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: { kind: "extraction", missionKey: "shortOreRun", phase: "transitOut", phaseProgressTicks: 0, cargo: {}, recalled: false } as any } : c)),
      expeditions: [{ id: "expedition-9", shipId: "ship-1" } as unknown as Expedition],
    };
    expect(salvageShipLockReason(flying, "ship-1")).toBe("shipOnMission");
    const r = salvageShip(flying, "ship-1", () => 0.5);
    if (!r.ok) expect(r.reason).toBe("shipOnMission");
    expect(canStartSalvage(flying, shipOrder("ship-1"))).toEqual({ ok: false, reason: "shipOnMission" });
  });

  it("an expedition on ANOTHER ship does not block this one", () => {
    const s: GameState = { ...crewedFleet(), expeditions: [{ id: "expedition-9", shipId: "ship-2" } as unknown as Expedition] };
    expect(salvageShipLockReason(s, "ship-1")).toBeNull();
    expect(salvageShip(s, "ship-1", () => 0.5).ok).toBe(true);
  });
});

describe("salvage releases everyone aboard atomically (CP-6)", () => {
  it("away members, officers and notables become unassigned; the complement returns to the pool", () => {
    const s = crewedFleet();
    const aboard = s.awayMembers.filter((m) => m.assignedShipId === "ship-1").map((m) => m.id);
    expect(aboard.length).toBe(2);
    const r = salvageShip(s, "ship-1", () => 0.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.next;
    for (const id of aboard) expect(n.awayMembers.find((m) => m.id === id)?.assignedShipId).toBeNull();
    // nobody else moved
    expect(n.awayMembers.find((m) => m.id === "member-90")?.assignedShipId).toBe("ship-2");
    expect(n.awayMembers.length).toBe(s.awayMembers.length);
    expect(n.officers.map((o) => [o.id, o.assignedShipId])).toEqual([
      ["officer-1", null],
      ["officer-2", "ship-2"],
      ["officer-3", null],
    ]);
    expect(n.notableCrew.map((x) => [x.id, x.assignedShipId])).toEqual([
      ["notable-1", null],
      ["notable-2", null],
    ]);
    // the 12 complement crew merge into the pool (5 + 10 security in one bucket, 2 science appended)
    expect(n.crewPool).toEqual([{ ...SEC, count: 15 }, { ...SCI, count: 2 }]);
    expect(totalCrew(n.crewPool)).toBe(17);
  });

  it("a member's own gear stays on them; a ground team loadout worn on the hull is checked back in", () => {
    const s = crewedFleet();
    const r = salvageShip(s, "ship-1", () => 0.5);
    if (!r.ok) throw new Error("expected ok");
    const [m1, m2] = s.awayMembers.filter((m) => m.assignedShipId === "ship-1").map((m) => m.id);
    expect(r.next.equipment.find((e) => e.id === "own-1")?.fittedToMemberId).toBe(m1);
    const kit = r.next.equipment.find((e) => e.id === "kit-1");
    expect(kit?.fittedToMemberId).toBeNull();
    expect(kit?.committedToLoadoutId).toBe("squad-1");
    expect(r.next.squadLoadouts[0].checkedOutTo).toBeNull();
    expect(m2).toBeDefined();
  });

  it("leaves no record pointing at the removed hull", () => {
    const r = salvageShip(crewedFleet(), "ship-1", () => 0.5);
    if (!r.ok) throw new Error("expected ok");
    const n = r.next;
    const ids = new Set(n.ships.map((x) => x.id));
    for (const m of n.awayMembers) if (m.assignedShipId !== null) expect(ids.has(m.assignedShipId)).toBe(true);
    for (const o of n.officers) if (o.assignedShipId !== null) expect(ids.has(o.assignedShipId)).toBe(true);
    for (const x of n.notableCrew) if (x.assignedShipId != null) expect(ids.has(x.assignedShipId)).toBe(true);
    for (const l of n.squadLoadouts) if (l.checkedOutTo !== null) expect(ids.has(l.checkedOutTo.shipId)).toBe(true);
    for (const l of n.loadouts) if (l.checkedOutToShipId !== null) expect(ids.has(l.checkedOutToShipId)).toBe(true);
    for (const e of n.equipment) if (e.fittedToShipId !== null) expect(ids.has(e.fittedToShipId)).toBe(true);
    // the remaining ship's slots name only members aboard it
    for (const ship of n.ships)
      for (const t of shipGroundTeams(ship))
        for (const id of [...t.security, ...t.science])
          if (id !== null) expect(n.awayMembers.find((m) => m.id === id)?.assignedShipId).toBe(ship.id);
  });

  it("a crewless hull salvages exactly as before (the people fields keep their references)", () => {
    const base = freshState();
    const s: GameState = {
      ...base,
      ships: [...base.ships, { id: "ship-2", typeKey: "generalFreighter", assignedCaptainId: null }],
    };
    const r = salvageShip(s, "ship-2", () => 0.5);
    if (!r.ok) throw new Error("expected ok");
    expect(r.next.awayMembers).toBe(s.awayMembers);
    expect(r.next.officers).toBe(s.officers);
    expect(r.next.notableCrew).toBe(s.notableCrew);
    expect(r.next.crewPool).toBe(s.crewPool);
    expect(r.next.squadLoadouts).toBe(s.squadLoadouts);
  });

  it("the input state is never mutated", () => {
    const s = crewedFleet();
    const before = JSON.stringify(s);
    salvageShip(s, "ship-1", () => 0.5);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("salvageShipPeople + salvageShipPeopleText: what the confirm dialog says goes back (CP-6)", () => {
  it("counts the complement, away members, officers and notables aboard", () => {
    expect(salvageShipPeople(crewedFleet(), "ship-1")).toEqual({ crew: 12, awayMembers: 2, officers: 1, notables: 1 });
    expect(salvageShipPeople(crewedFleet(), "ship-2")).toEqual({ crew: 0, awayMembers: 1, officers: 1, notables: 0 });
    expect(salvageShipPeople(crewedFleet(), "ship-nope")).toEqual({ crew: 0, awayMembers: 0, officers: 0, notables: 0 });
  });

  it("matches what salvage actually releases", () => {
    const s = crewedFleet();
    const p = salvageShipPeople(s, "ship-1");
    const r = salvageShip(s, "ship-1", () => 0.5);
    if (!r.ok) throw new Error("expected ok");
    expect(totalCrew(r.next.crewPool) - totalCrew(s.crewPool)).toBe(p.crew);
  });

  it("words it with plurals and US English, no dashes", () => {
    expect(salvageShipPeopleText({ crew: 12, awayMembers: 3, officers: 1, notables: 0 })).toBe(
      "12 crew return to the pool; 3 away members and 1 officer become unassigned."
    );
    expect(salvageShipPeopleText({ crew: 1, awayMembers: 0, officers: 0, notables: 0 })).toBe("1 crew member returns to the pool.");
    expect(salvageShipPeopleText({ crew: 0, awayMembers: 1, officers: 0, notables: 0 })).toBe("1 away member becomes unassigned.");
    expect(salvageShipPeopleText({ crew: 0, awayMembers: 2, officers: 2, notables: 1 })).toBe(
      "2 away members, 2 officers and 1 notable crew member become unassigned."
    );
    expect(salvageShipPeopleText({ crew: 1500, awayMembers: 0, officers: 0, notables: 2 })).toBe(
      "1,500 crew return to the pool; 2 notable crew members become unassigned."
    );
    expect(salvageShipPeopleText({ crew: 0, awayMembers: 0, officers: 0, notables: 0 })).toBeNull();
  });
});

describe("migrate, v68 -> v69 orphaned ship references repaired (CP-6)", () => {
  const migrateFrom = (version: number, state: any): any =>
    migrate({ version, created_at: 0, last_saved_at: 0, game_time_seconds: 0, state } as SaveFile);
  const raw = (state: GameState): any => (deserialize(serialize(state, 0)) as SaveFile).state;

  // A staging save that salvaged ship-7 before this fix: its people still name it.
  function orphaned(): GameState {
    const s = crewedFleet();
    return {
      ...s,
      awayMembers: [...s.awayMembers, plainAwayMember("member-70", "science", "ship-7")],
      officers: [...s.officers, officer("officer-7", "ship-7")],
      notableCrew: [...s.notableCrew, notable("notable-7", "ship-7")],
      equipment: [...s.equipment, wornPiece("kit-7", "member-70", "squad-7")],
      squadLoadouts: [
        ...s.squadLoadouts,
        { id: "squad-7", name: "Lost", security: [], science: [], checkedOutTo: { shipId: "ship-7", teamIndex: 1 } },
      ],
    };
  }

  it("unassigns members, officers and notables naming a missing hull, and checks in its ground loadouts", () => {
    const before = raw(orphaned());
    const m = migrateFrom(68, JSON.parse(JSON.stringify(before)));
    expect(m.awayMembers.find((x: any) => x.id === "member-70").assignedShipId).toBeNull();
    expect(m.officers.find((x: any) => x.id === "officer-7").assignedShipId).toBeNull();
    expect(m.notableCrew.find((x: any) => x.id === "notable-7").assignedShipId).toBeNull();
    expect(m.squadLoadouts.find((x: any) => x.id === "squad-7").checkedOutTo).toBeNull();
    const kit = m.equipment.find((x: any) => x.id === "kit-7");
    expect(kit.fittedToMemberId).toBeNull();
    expect(kit.committedToLoadoutId).toBe("squad-7");
    // everyone on a live hull is untouched
    for (const id of ["officer-1", "officer-2"]) {
      expect(m.officers.find((x: any) => x.id === id).assignedShipId).toBe(before.officers.find((x: any) => x.id === id).assignedShipId);
    }
    expect(m.awayMembers.filter((x: any) => x.id !== "member-70")).toEqual(before.awayMembers.filter((x: any) => x.id !== "member-70"));
    expect(m.squadLoadouts.find((x: any) => x.id === "squad-1")).toEqual(before.squadLoadouts.find((x: any) => x.id === "squad-1"));
    expect(m.equipment.find((x: any) => x.id === "kit-1")).toEqual(before.equipment.find((x: any) => x.id === "kit-1"));
  });

  it("a clean save loads byte-identically to the same save at the current version", () => {
    const clean = raw(crewedFleet());
    const via = migrateFrom(68, JSON.parse(JSON.stringify(clean)));
    const at = migrateFrom(SAVE_VERSION, JSON.parse(JSON.stringify(clean)));
    expect(JSON.stringify(via)).toBe(JSON.stringify(at));
    const fresh = raw(freshState());
    expect(JSON.stringify(migrateFrom(68, JSON.parse(JSON.stringify(fresh))))).toBe(
      JSON.stringify(migrateFrom(SAVE_VERSION, JSON.parse(JSON.stringify(fresh))))
    );
  });

  it("is idempotent (a repaired save repaired again is unchanged)", () => {
    const once = migrateFrom(68, raw(orphaned()));
    const twice = migrateFrom(68, raw(once));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("is hardened against malformed fields (non-arrays and junk entries pass through)", () => {
    for (const bad of [undefined, null, "corrupt", 7]) {
      const r = raw(orphaned());
      r.awayMembers = bad;
      r.officers = bad;
      r.notableCrew = bad;
      r.squadLoadouts = bad;
      expect(() => migrateFrom(68, r)).not.toThrow();
    }
    const r = raw(orphaned());
    r.awayMembers = [...r.awayMembers, null, 3, "x"];
    r.officers = [...r.officers, null];
    r.squadLoadouts = [...r.squadLoadouts, null, { id: "squad-8", checkedOutTo: "junk" }];
    expect(() => migrateFrom(68, r)).not.toThrow();
    // the step alone (the full load needs a real ships array to hydrate): a non-array ships field means nothing can be judged missing: nothing changes
    const noShips = raw(orphaned());
    noShips.ships = "corrupt";
    const viaStep = repairOrphanedShipRefsV69(JSON.parse(JSON.stringify(noShips)));
    expect(viaStep.awayMembers).toEqual(noShips.awayMembers);
  });
});

// ============================================================================
// CP-6 review follow-ups
// ============================================================================

describe("a QUEUED hull teardown releases everyone exactly like the instant path (CP-6 review)", () => {
  it("resolveProcesses' salvageResolve applies every field salvageShip writes", () => {
    const base = crewedFleet();
    // A ship loadout checked out to the hull too (the pre-existing loadouts write-back gap).
    const s: GameState = {
      ...base,
      loadouts: [{ id: "loadout-1", name: "Set", shipTypeKey: "generalFreighter", slots: {}, checkedOutToShipId: "ship-1" }],
      activeProcesses: [
        { id: "proc-1", kind: "salvageJob", remainingTicks: 1, durationTicks: 1, effect: { type: "salvageResolve", target: { kind: "ship", shipId: "ship-1" } } },
      ],
    };
    const instant = salvageShip({ ...s, activeProcesses: [] }, "ship-1", () => 0.5);
    if (!instant.ok) throw new Error("expected the instant salvage to succeed");
    const viaTick = resolveProcesses(s, 1, () => 0.5).next;
    expect(viaTick.ships.some((x) => x.id === "ship-1")).toBe(false);
    for (const key of ["ships", "awayMembers", "officers", "notableCrew", "crewPool", "squadLoadouts", "loadouts", "equipment", "credits", "inventory"] as const) {
      expect(JSON.stringify(viaTick[key])).toBe(JSON.stringify(instant.next[key]));
    }
    // non-vacuous: people really moved
    expect(viaTick.officers.find((o) => o.id === "officer-1")?.assignedShipId).toBeNull();
    expect(totalCrew(viaTick.crewPool)).toBe(17);
    expect(viaTick.loadouts[0].checkedOutToShipId).toBeNull();
  });

  it("an equipment or material salvage leaves the people fields byte-identical", () => {
    const s: GameState = {
      ...crewedFleet(),
      activeProcesses: [
        { id: "proc-1", kind: "salvageJob", remainingTicks: 1, durationTicks: 1, effect: { type: "salvageResolve", target: { kind: "equipment", instanceId: "nope" } } },
      ],
    };
    const next = resolveProcesses(s, 1, () => 0.5).next;
    for (const key of ["awayMembers", "officers", "notableCrew", "crewPool", "squadLoadouts", "loadouts"] as const) expect(next[key]).toBe(s[key]);
  });
});

describe("salvage refuses while a loadout worn here is also worn on a locked ship (CP-6 review)", () => {
  // squad-1 is checked out to ship-1; its piece kit-1 is worn by a member who has since moved to ship-2.
  function wornAcross(): GameState {
    const s = crewedFleet();
    const wearer = s.equipment.find((e) => e.id === "kit-1")?.fittedToMemberId;
    return { ...s, awayMembers: s.awayMembers.map((m) => (m.id === wearer ? { ...m, assignedShipId: "ship-2" } : m)) };
  }
  const out = (s: GameState): GameState => ({ ...s, expeditions: [{ id: "expedition-9", shipId: "ship-2" } as unknown as Expedition] });
  const shipOrder = (shipId: string): QueuedOrder => ({ type: "salvage", target: { kind: "ship", shipId }, mode: { kind: "batch", remaining: 1 } });

  it("refuses with loadoutWornOnLockedShip on every path, same reference", () => {
    const s = out(wornAcross());
    expect(salvageShipLockReason(s, "ship-1")).toBe("loadoutWornOnLockedShip");
    const r = salvageShip(s, "ship-1", () => 0.5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("loadoutWornOnLockedShip");
      expect(r.next).toBe(s);
    }
    expect(canStartSalvage(s, shipOrder("ship-1"))).toEqual({ ok: false, reason: "loadoutWornOnLockedShip" });
  });

  it("salvages (and checks the loadout in) once that ship is back", () => {
    const s = wornAcross();
    expect(salvageShipLockReason(s, "ship-1")).toBeNull();
    const r = salvageShip(s, "ship-1", () => 0.5);
    if (!r.ok) throw new Error("expected ok");
    expect(r.next.equipment.find((e) => e.id === "kit-1")?.fittedToMemberId).toBeNull();
  });
});

describe("a ghost expedition (its ship already gone, pre-fix saves) stays claimable (CP-6 review)", () => {
  it("orphanExpeditions lists it and the claim deposits and removes it", () => {
    const s = onExpedition();
    const exp = advanceExpedition(s.expeditions[0], 10_000_000);
    const ghost: GameState = { ...s, ships: s.ships.filter((x) => x.id !== "ship-1"), expeditions: [exp] };
    expect(orphanExpeditions(ghost).map((e) => e.id)).toEqual([exp.id]);
    expect(orphanExpeditions(s)).toEqual([]);
    const claimed = claimExpedition(ghost, exp.id);
    expect(claimed.success).toBe(true);
    expect(claimed.next.expeditions).toEqual([]);
    expect(claimed.next.ships).toEqual(ghost.ships);
  });
});
