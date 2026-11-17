// Crew 0.14.0 (Phase C-2): tests for the PERSONNEL ROSTERS engine (personnelRosters.ts).
// Covers: CRUD (create mints an id + appends; update overwrites; delete removes; loadout-link guards),
// the pure per-field editors (rename / link / includePeople / assignSeat with seat-type matching /
// pin / unpin / reorder / move up-down, all validating ids), applyRoster (officers land in their
// seats + evict a prior occupant; pinned notables get assignedShipId in PRIORITY order and are
// CAP-LIMITED; bulk auto-fills the remainder without exceeding cap; the roster object is UNCHANGED;
// includePeople=false applies no people; missing roster/ship no-op), the v56->v57 migration backfill,
// and an additive-neutrality check that a populated roster does not change what the tick produces
// (crew parity unaffected). The engine runs ONLY on explicit action, never on the tick.

import { describe, it, expect } from "vitest";
import { freshState } from "./model";
import type {
  GameState,
  SeniorStaffOfficer,
  NotableCrewMember,
  PersonnelRoster,
  CrewBucket,
} from "./model";
import type { SaveFile } from "./save";
import {
  createRoster,
  updateRoster,
  deleteRoster,
  renameRoster,
  setLinkedLoadout,
  setLinkedSquadLoadout,
  rosterSquadLinkSlots,
  setIncludePeople,
  assignSeat,
  pinNotable,
  unpinNotable,
  reorderNotable,
  moveNotableUp,
  moveNotableDown,
  applyRoster,
  toggleNotableFavorite,
} from "./personnelRosters";
import { createLoadout } from "./armory";
import { divisionCap, countInDivision } from "./commandStructure";
import { totalCrew } from "./crew";
import { migrate } from "./save";
import { tick } from "./tick";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

// --- fixtures ---------------------------------------------------------------

const HULL = "generalFreighter"; // freshState's ship-1 hull

function stateWith(
  opts: {
    officers?: SeniorStaffOfficer[];
    notableCrew?: NotableCrewMember[];
    crewPool?: CrewBucket[];
    rosters?: PersonnelRoster[];
  } = {},
): GameState {
  const base = freshState();
  return {
    ...base,
    officers: opts.officers ?? [],
    notableCrew: opts.notableCrew ?? [],
    crewPool: opts.crewPool ?? [],
    personnelRosters: opts.rosters ?? [],
  };
}

function officer(overrides: Partial<SeniorStaffOfficer> = {}): SeniorStaffOfficer {
  return {
    id: "officer-1",
    seat: "tactical",
    name: "Test Officer",
    race: "earthBorn",
    gender: "female",
    rank: "cadet",
    bonuses: [
      { id: "b1", magnitude: 0.1 },
      { id: "b2", magnitude: 0.1 },
    ],
    missionsCompleted: 0,
    assignedShipId: null,
    ...overrides,
  };
}

function notable(overrides: Partial<NotableCrewMember> = {}): NotableCrewMember {
  return {
    id: "notable-1",
    profession: "security",
    rarity: "standard",
    rank: 1,
    race: "earthBorn",
    buff1Id: "b1",
    buff2Id: null,
    name: "Standout",
    gender: "female",
    ...overrides,
  };
}

function bucket(overrides: Partial<CrewBucket> = {}): CrewBucket {
  return {
    profession: "security",
    rarity: "standard",
    rank: 1,
    race: "earthBorn",
    buff1Id: "b1",
    buff2Id: null,
    count: 1,
    ...overrides,
  };
}

// ============================================================================
// CRUD
// ============================================================================

describe("roster CRUD", () => {
  it("createRoster mints roster-1, appends it, advances nextRosterId, and defaults name + includePeople", () => {
    const s = stateWith();
    const { next, rosterId } = createRoster(s, { name: "  Alpha  " });
    expect(rosterId).toBe("roster-1");
    expect(next.personnelRosters).toHaveLength(1);
    expect(next.nextRosterId).toBe(2);
    const r = next.personnelRosters[0];
    expect(r).toEqual({
      id: "roster-1",
      name: "Alpha", // trimmed
      linkedLoadoutId: null,
      includePeople: true,
      seatAssignments: {},
      pinnedNotableCrew: [],
    });
  });

  it("createRoster falls back to a default name for an all-whitespace name", () => {
    const { next } = createRoster(stateWith(), { name: "   " });
    expect(next.personnelRosters[0].name).toBe("New Roster");
  });

  it("createRoster accepts a valid loadout link and refuses a non-existent one (same-ref, null id)", () => {
    // A real loadout to link.
    const { next: withLoadout, loadoutId } = createLoadout(stateWith(), HULL, "L1");
    const ok = createRoster(withLoadout, { linkedLoadoutId: loadoutId });
    expect(ok.rosterId).toBe("roster-1");
    expect(ok.next.personnelRosters[0].linkedLoadoutId).toBe(loadoutId);

    const bad = createRoster(withLoadout, { linkedLoadoutId: "loadout-nope" });
    expect(bad.rosterId).toBeNull();
    expect(bad.next).toBe(withLoadout); // same-ref no-op
  });

  it("updateRoster overwrites the fields present in the patch, by id", () => {
    const s = createRoster(stateWith(), { name: "R" }).next;
    const next = updateRoster(s, "roster-1", {
      name: "Bridge Alpha",
      includePeople: false,
      seatAssignments: { pilot: "officer-9" },
      pinnedNotableCrew: ["notable-3"],
    });
    const r = next.personnelRosters[0];
    expect(r.name).toBe("Bridge Alpha");
    expect(r.includePeople).toBe(false);
    expect(r.seatAssignments).toEqual({ pilot: "officer-9" });
    expect(r.pinnedNotableCrew).toEqual(["notable-3"]);
  });

  it("updateRoster is a same-ref no-op for a missing roster or a bad loadout link", () => {
    const s = createRoster(stateWith(), { name: "R" }).next;
    expect(updateRoster(s, "roster-nope", { name: "X" })).toBe(s);
    expect(updateRoster(s, "roster-1", { linkedLoadoutId: "loadout-nope" })).toBe(s);
  });

  it("deleteRoster removes by id and is a same-ref no-op when missing", () => {
    const s = createRoster(stateWith(), { name: "R" }).next;
    expect(deleteRoster(s, "roster-1").personnelRosters).toHaveLength(0);
    expect(deleteRoster(s, "roster-nope")).toBe(s);
  });
});

// ============================================================================
// Editors
// ============================================================================

describe("roster editors", () => {
  function seeded(): { s: GameState; id: string } {
    const { next, rosterId } = createRoster(stateWith({ officers: [officer()], notableCrew: [notable()] }), {
      name: "R",
    });
    return { s: next, id: rosterId! };
  }

  it("renameRoster trims, ignores blank, and no-ops when unchanged or missing", () => {
    const { s, id } = seeded();
    expect(renameRoster(s, id, "  New Name  ").personnelRosters[0].name).toBe("New Name");
    expect(renameRoster(s, id, "   ")).toBe(s); // blank ignored
    expect(renameRoster(s, id, "R")).toBe(s); // unchanged
    expect(renameRoster(s, "roster-nope", "X")).toBe(s); // missing
  });

  it("setLinkedLoadout sets/clears a valid link and refuses a bad one", () => {
    const withLoadout = createLoadout(stateWith(), HULL, "L1");
    const created = createRoster(withLoadout.next, { name: "R" });
    const s = created.next;
    const linked = setLinkedLoadout(s, created.rosterId!, withLoadout.loadoutId);
    expect(linked.personnelRosters[0].linkedLoadoutId).toBe(withLoadout.loadoutId);
    expect(setLinkedLoadout(linked, created.rosterId!, null).personnelRosters[0].linkedLoadoutId).toBeNull();
    expect(setLinkedLoadout(s, created.rosterId!, "loadout-nope")).toBe(s); // bad link refused
  });

  it("setIncludePeople toggles the flag and no-ops when unchanged", () => {
    const { s, id } = seeded();
    expect(setIncludePeople(s, id, false).personnelRosters[0].includePeople).toBe(false);
    expect(setIncludePeople(s, id, true)).toBe(s); // already true
  });

  it("assignSeat pins a matching officer, clears with null, and refuses a seat-type mismatch or missing officer", () => {
    const { s, id } = seeded(); // officer-1 seat = tactical
    const pinned = assignSeat(s, id, "tactical", "officer-1");
    expect(pinned.personnelRosters[0].seatAssignments).toEqual({ tactical: "officer-1" });
    // Seat-type mismatch (officer-1 is tactical, not pilot) is refused.
    expect(assignSeat(s, id, "pilot", "officer-1")).toBe(s);
    // Missing officer refused.
    expect(assignSeat(s, id, "tactical", "officer-nope")).toBe(s);
    // Clear the seat.
    expect(assignSeat(pinned, id, "tactical", null).personnelRosters[0].seatAssignments).toEqual({});
  });

  it("pinNotable appends, dedupes, and validates the id; unpinNotable removes", () => {
    const { s, id } = seeded(); // notable-1 exists
    const pinned = pinNotable(s, id, "notable-1");
    expect(pinned.personnelRosters[0].pinnedNotableCrew).toEqual(["notable-1"]);
    expect(pinNotable(pinned, id, "notable-1")).toBe(pinned); // already pinned (same ref)
    expect(pinNotable(s, id, "notable-nope")).toBe(s); // unknown notable
    expect(unpinNotable(pinned, id, "notable-1").personnelRosters[0].pinnedNotableCrew).toEqual([]);
    expect(unpinNotable(s, id, "notable-1")).toBe(s); // not pinned -> same ref
  });

  it("reorderNotable moves an entry and no-ops on an out-of-range index", () => {
    const notables = [notable({ id: "n1" }), notable({ id: "n2" }), notable({ id: "n3" })];
    let s = createRoster(stateWith({ notableCrew: notables }), { name: "R" }).next;
    s = pinNotable(s, "roster-1", "n1");
    s = pinNotable(s, "roster-1", "n2");
    s = pinNotable(s, "roster-1", "n3");
    expect(s.personnelRosters[0].pinnedNotableCrew).toEqual(["n1", "n2", "n3"]);
    // Move n3 (index 2) to the front (index 0).
    const moved = reorderNotable(s, "roster-1", 2, 0);
    expect(moved.personnelRosters[0].pinnedNotableCrew).toEqual(["n3", "n1", "n2"]);
    // Out of range -> same ref.
    expect(reorderNotable(s, "roster-1", 5, 0)).toBe(s);
    expect(reorderNotable(s, "roster-1", 0, 0)).toBe(s); // no move
  });

  it("moveNotableUp / moveNotableDown step an entry and no-op at the edges", () => {
    const notables = [notable({ id: "n1" }), notable({ id: "n2" }), notable({ id: "n3" })];
    let s = createRoster(stateWith({ notableCrew: notables }), { name: "R" }).next;
    for (const nid of ["n1", "n2", "n3"]) s = pinNotable(s, "roster-1", nid);
    expect(moveNotableUp(s, "roster-1", "n3").personnelRosters[0].pinnedNotableCrew).toEqual(["n1", "n3", "n2"]);
    expect(moveNotableDown(s, "roster-1", "n1").personnelRosters[0].pinnedNotableCrew).toEqual(["n2", "n1", "n3"]);
    expect(moveNotableUp(s, "roster-1", "n1")).toBe(s); // already at the top
    expect(moveNotableDown(s, "roster-1", "n3")).toBe(s); // already at the bottom
  });
});

// ============================================================================
// applyRoster
// ============================================================================

describe("applyRoster", () => {
  it("assigns each pinned officer to its seat on the ship (and evicts a different prior occupant)", () => {
    const chosen = officer({ id: "officer-1", seat: "tactical", assignedShipId: null });
    const priorOccupant = officer({ id: "officer-2", seat: "tactical", assignedShipId: "ship-1" });
    let s = stateWith({ officers: [chosen, priorOccupant] });
    const { next, rosterId } = createRoster(s, { name: "R" });
    s = assignSeat(next, rosterId!, "tactical", "officer-1");

    const applied = applyRoster(s, rosterId!, "ship-1");
    expect(applied.officers.find((o) => o.id === "officer-1")!.assignedShipId).toBe("ship-1");
    // The prior tactical occupant was evicted so the roster's pick could land.
    expect(applied.officers.find((o) => o.id === "officer-2")!.assignedShipId).toBeNull();
  });

  it("assigns pinned notables in PRIORITY order, cap-limited to the ship's division cap", () => {
    const cap = divisionCap(HULL, "security");
    expect(cap).toBeGreaterThan(0);
    // More security notables than the security cap allows.
    const total = cap + 2;
    const notables = Array.from({ length: total }, (_, i) =>
      notable({ id: `n${i}`, profession: "security", rank: 1 }),
    );
    let s = createRoster(stateWith({ notableCrew: notables }), { name: "R" }).next;
    // Pin in a DELIBERATE priority order: highest-index first.
    const priority = notables.map((n) => n.id).reverse();
    for (const id of priority) s = pinNotable(s, "roster-1", id);

    const applied = applyRoster(s, "roster-1", "ship-1");
    const assigned = applied.notableCrew.filter((n) => (n.assignedShipId ?? null) === "ship-1").map((n) => n.id);
    // Exactly `cap` accepted, and they are the FIRST `cap` in priority order.
    expect(assigned).toHaveLength(cap);
    expect(new Set(assigned)).toEqual(new Set(priority.slice(0, cap)));
    // The overflow pins were skipped safely (left unassigned).
    for (const id of priority.slice(cap)) {
      expect(applied.notableCrew.find((n) => n.id === id)!.assignedShipId ?? null).toBeNull();
    }
  });

  // CP-5 review (2026-11-02): a pin already aboard holds its seat BEFORE any pin not yet aboard is gated, so pin B (not
  // aboard) can never take the last seat while pin A (aboard) stays and the ship goes over its cap through an add.
  it("a pin already aboard keeps its seat first: a later-aboard pin never pushes the ship over its cap", () => {
    const cap = divisionCap(HULL, "security");
    // Bulk fills the division to one under its cap; pin A is already aboard (so the ship is exactly full).
    const ship1Bulk = [bucket({ profession: "security", rank: 1, count: cap - 1 })];
    const a = notable({ id: "nA", profession: "security", rank: 1, assignedShipId: "ship-1" });
    const b = notable({ id: "nB", profession: "security", rank: 1 });
    let s = createRoster(stateWith({ notableCrew: [a, b] }), { name: "R" }).next;
    s = { ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, complement: { buckets: ship1Bulk, mode: "active" as const } } : x)) };
    s = pinNotable(s, "roster-1", "nB"); // B first in priority
    s = pinNotable(s, "roster-1", "nA");

    const applied = applyRoster(s, "roster-1", "ship-1");
    expect(applied.notableCrew.find((n) => n.id === "nA")!.assignedShipId).toBe("ship-1");
    expect(applied.notableCrew.find((n) => n.id === "nB")!.assignedShipId ?? null).toBeNull();
    const ship = applied.ships.find((x) => x.id === "ship-1")!;
    const aboard = applied.notableCrew.filter((n) => n.assignedShipId === "ship-1").length;
    expect(countInDivision(ship.complement!.buckets, "security") + aboard).toBe(cap);
  });

  it("auto-fills the remaining berths with bulk from the pool without exceeding cap; the pinned notable keeps its slot", () => {
    const cap = divisionCap(HULL, "security");
    const notables = [notable({ id: "n1", profession: "security", rank: 1 })];
    // A large same-signature pool bucket so the bulk fill is only bounded by the cap.
    const pool = [bucket({ profession: "security", rank: 1, count: 50 })];
    let s = createRoster(stateWith({ notableCrew: notables, crewPool: pool }), { name: "R" }).next;
    s = pinNotable(s, "roster-1", "n1");

    const applied = applyRoster(s, "roster-1", "ship-1");
    const ship = applied.ships.find((x) => x.id === "ship-1")!;
    const bulkSecurity = countInDivision(ship.complement!.buckets, "security");
    // The notable took ONE slot, so bulk fills cap - 1, and notable + bulk == cap (never above).
    expect(applied.notableCrew.find((n) => n.id === "n1")!.assignedShipId).toBe("ship-1");
    expect(bulkSecurity).toBe(cap - 1);
    expect(bulkSecurity + 1).toBe(cap);
    // The pool was drawn down by exactly the bulk added (no crew created or destroyed).
    expect(totalCrew(applied.crewPool)).toBe(50 - (cap - 1));
  });

  it("leaves the roster object UNCHANGED (auto-filled randoms are never written back)", () => {
    const notables = [notable({ id: "n1", profession: "security", rank: 1 })];
    const pool = [bucket({ profession: "security", rank: 1, count: 50 })];
    let s = createRoster(stateWith({ notableCrew: notables, crewPool: pool }), { name: "R" }).next;
    s = pinNotable(s, "roster-1", "n1");
    const before = s.personnelRosters[0];

    const applied = applyRoster(s, "roster-1", "ship-1");
    expect(applied.personnelRosters[0]).toEqual(before); // pins unchanged, no randoms folded in
  });

  it("includePeople=false applies NO people (same-ref no-op)", () => {
    const notables = [notable({ id: "n1" })];
    const pool = [bucket({ count: 50 })];
    let s = createRoster(stateWith({ notableCrew: notables, crewPool: pool }), { name: "R", includePeople: false })
      .next;
    s = pinNotable(s, "roster-1", "n1"); // even with a pin, includePeople=false means nothing applies
    expect(applyRoster(s, "roster-1", "ship-1")).toBe(s);
  });

  it("is a same-ref no-op for a missing roster or a missing ship", () => {
    const s = createRoster(stateWith(), { name: "R" }).next;
    expect(applyRoster(s, "roster-nope", "ship-1")).toBe(s);
    expect(applyRoster(s, "roster-1", "ship-nope")).toBe(s);
  });
});

// S4-CP39 (carried from E-CREW Task 18 into Ground Ops GO-17): a roster LINKED to an Armory ship loadout
// applies that loadout with its people, gear first (so the caps read the new gear). Never forced: a loadout
// worn by another ship stays there, a loadout for another hull or a ship on a mission leaves the gear alone.
describe("applyRoster applies its linked SHIP loadout (S4-CP39)", () => {
  // A gear-only roster (includePeople false) linked to a fresh General Freighter loadout.
  function linked(base: GameState = stateWith(), hull: "generalFreighter" | "destroyer" = HULL) {
    const lo = createLoadout(base, hull, "Linked");
    const r = createRoster(lo.next, { name: "R", includePeople: false, linkedLoadoutId: lo.loadoutId });
    return { s: r.next, loadoutId: lo.loadoutId!, rosterId: r.rosterId! };
  }
  const wornOn = (s: GameState, loadoutId: string) => s.loadouts.find((l) => l.id === loadoutId)!.checkedOutToShipId;

  it("checks the linked loadout out to the ship, even for a gear-only roster", () => {
    const { s, loadoutId, rosterId } = linked();
    const applied = applyRoster(s, rosterId, "ship-1");
    expect(wornOn(applied, loadoutId)).toBe("ship-1");
    expect(wornOn(s, loadoutId)).toBeNull(); // input untouched
  });

  it("a ship wearing a different loadout checks it in first", () => {
    const { s, loadoutId, rosterId } = linked();
    const other = createLoadout(s, HULL, "Other");
    const worn = { ...other.next, loadouts: other.next.loadouts.map((l) => (l.id === other.loadoutId ? { ...l, checkedOutToShipId: "ship-1" } : l)) };
    const applied = applyRoster(worn, rosterId, "ship-1");
    expect(wornOn(applied, other.loadoutId!)).toBeNull();
    expect(wornOn(applied, loadoutId)).toBe("ship-1");
  });

  it("never pulls a loadout off another ship, never applies one for another hull, never on a mission", () => {
    const a = linked();
    const elsewhere = { ...a.s, loadouts: a.s.loadouts.map((l) => ({ ...l, checkedOutToShipId: "ship-9" })) };
    expect(applyRoster(elsewhere, a.rosterId, "ship-1")).toBe(elsewhere);

    const b = linked(stateWith(), "destroyer");
    expect(applyRoster(b.s, b.rosterId, "ship-1")).toBe(b.s);

    const c = linked();
    const mission = {
      kind: "extraction", missionKey: "shortOreRun", phase: "transitOut", phaseProgressTicks: 0, cargo: {}, recalled: false,
    } as unknown as NonNullable<GameState["captains"][number]["mission"]>;
    const away = { ...c.s, captains: c.s.captains.map((cap) => (cap.id === 1 ? { ...cap, mission } : cap)) };
    expect(applyRoster(away, c.rosterId, "ship-1")).toBe(away);
  });

  it("a loadout the ship already wears is left as it is", () => {
    const { s, loadoutId, rosterId } = linked();
    const worn = { ...s, loadouts: s.loadouts.map((l) => (l.id === loadoutId ? { ...l, checkedOutToShipId: "ship-1" } : l)) };
    expect(applyRoster(worn, rosterId, "ship-1")).toBe(worn);
  });
});

// GO-17 UI (user S14: "rosters link squad loadouts one per team"): a roster links one Armory GROUND TEAM
// loadout per team index and applyRoster puts each on its team, the ship loadout rule (never forced, never
// pulled off another team, a refused put leaves the team as it was).
describe("applyRoster applies its linked SQUAD loadouts (GO-17 UI)", () => {
  const emptyKit = () => ({ armor: null, weapon: null, tool: null, implants: [] as string[] });
  const squad = (id: string, kind: "ground" | "strike" | "survey" = "ground", checkedOutTo: { shipId: string; teamIndex: number } | null = null) => ({
    id, name: id, kind, security: [emptyKit()], science: [emptyKit()], checkedOutTo,
  });
  function withSquads(squads: ReturnType<typeof squad>[], links: (string | null)[] = []) {
    const base = stateWith();
    const r = createRoster({ ...base, squadLoadouts: squads, nextSquadLoadoutId: squads.length + 1 }, { name: "R", includePeople: false });
    let s = r.next;
    links.forEach((id, i) => { s = setLinkedSquadLoadout(s, r.rosterId!, i, id); });
    return { s, rosterId: r.rosterId! };
  }
  const wornBy = (s: GameState, id: string) => s.squadLoadouts.find((l) => l.id === id)!.checkedOutTo;
  const linksOf = (s: GameState, rosterId: string) => s.personnelRosters.find((r) => r.id === rosterId)!.linkedSquadLoadoutIds;

  it("setLinkedSquadLoadout links one loadout per team, moves a repeat, clears, and refuses bad input same-ref", () => {
    const { s, rosterId } = withSquads([squad("squad-1"), squad("squad-2")]);
    const a = setLinkedSquadLoadout(s, rosterId, 1, "squad-2");
    expect(linksOf(a, rosterId)).toEqual([null, "squad-2"]);
    const moved = setLinkedSquadLoadout(a, rosterId, 0, "squad-2"); // one team per loadout
    expect(linksOf(moved, rosterId)).toEqual(["squad-2"]);
    const cleared = setLinkedSquadLoadout(moved, rosterId, 0, null);
    expect(linksOf(cleared, rosterId)).toBeUndefined();
    expect(setLinkedSquadLoadout(a, rosterId, 1, "squad-2")).toBe(a); // unchanged
    expect(setLinkedSquadLoadout(a, rosterId, 0, "squad-9")).toBe(a); // no such loadout
    expect(setLinkedSquadLoadout(a, rosterId, -1, "squad-1")).toBe(a);
    expect(setLinkedSquadLoadout(a, rosterId, 1.5, "squad-1")).toBe(a);
    expect(setLinkedSquadLoadout(a, rosterId, rosterSquadLinkSlots(), "squad-1")).toBe(a);
    expect(setLinkedSquadLoadout(a, "roster-9", 0, "squad-1")).toBe(a);
  });

  it("puts each linked loadout on its team, even for a gear-only roster", () => {
    const { s, rosterId } = withSquads([squad("squad-1"), squad("squad-2")], ["squad-2", "squad-1"]);
    const applied = applyRoster(s, rosterId, "ship-1");
    expect(wornBy(applied, "squad-2")).toEqual({ shipId: "ship-1", teamIndex: 0 });
    expect(wornBy(applied, "squad-1")).toEqual({ shipId: "ship-1", teamIndex: 1 });
    expect(wornBy(s, "squad-1")).toBeNull(); // input untouched
  });

  it("a team wearing a different loadout checks it in first", () => {
    const { s, rosterId } = withSquads([squad("squad-1"), squad("squad-2", "ground", { shipId: "ship-1", teamIndex: 0 })], ["squad-1"]);
    const applied = applyRoster(s, rosterId, "ship-1");
    expect(wornBy(applied, "squad-2")).toBeNull();
    expect(wornBy(applied, "squad-1")).toEqual({ shipId: "ship-1", teamIndex: 0 });
  });

  it("never pulls a loadout off another team; a refused put (other team type) leaves the team as it was", () => {
    const worn = withSquads([squad("squad-1", "ground", { shipId: "ship-9", teamIndex: 0 })], ["squad-1"]);
    expect(applyRoster(worn.s, worn.rosterId, "ship-1")).toBe(worn.s);

    const kind = withSquads([squad("squad-1", "strike"), squad("squad-2", "ground", { shipId: "ship-1", teamIndex: 0 })], ["squad-1"]);
    const out = applyRoster(kind.s, kind.rosterId, "ship-1");
    expect(out).toBe(kind.s);
    expect(wornBy(out, "squad-2")).toEqual({ shipId: "ship-1", teamIndex: 0 });

    const gone = withSquads([squad("squad-1")], ["squad-1"]);
    const deleted = { ...gone.s, squadLoadouts: [] };
    expect(applyRoster(deleted, gone.rosterId, "ship-1")).toBe(deleted);
  });
});

// ============================================================================
// Migration + additive-neutrality
// ============================================================================

describe("v56 -> v57 migration backfills an old save", () => {
  it("adds personnelRosters: [] and nextRosterId: 1 to a save that predates them", () => {
    const base = freshState();
    const { personnelRosters, nextRosterId, ...preRosters } = base as any;
    const save: SaveFile = {
      version: 56,
      created_at: 0,
      last_saved_at: 0,
      game_time_seconds: 0,
      state: preRosters as any,
    };
    const migrated: any = migrate(save);
    expect(migrated.personnelRosters).toEqual([]);
    expect(migrated.nextRosterId).toBe(1);
  });
});

describe("additive-neutrality: a populated roster does not change what the tick produces", () => {
  // A deterministic rng so any rng-driven tick work stays identical across both runs.
  function seededRng(): () => number {
    let x = 0x12345678;
    return () => {
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) ^ 0x9e3779b9) >>> 0;
      return (x >>> 8) / (1 << 24);
    };
  }

  it("crew parity is unaffected: ticking with vs without the roster fields yields the same non-roster state", () => {
    const SPAN = 5000; // seconds; crosses transport windows so the crew engine actually runs

    // A state carrying a populated roster + notable + officer, so the roster fields are non-trivial.
    const withRoster = stateWith({
      officers: [officer({ assignedShipId: "ship-1" })],
      notableCrew: [notable({ id: "n1" })],
      rosters: [
        {
          id: "roster-1",
          name: "R",
          linkedLoadoutId: null,
          includePeople: true,
          seatAssignments: { tactical: "officer-1" },
          pinnedNotableCrew: ["n1"],
        },
      ],
    });
    // The SAME state with the two roster fields stripped entirely (a genuine no-roster shape).
    const { personnelRosters, nextRosterId, ...withoutRoster } = withRoster as any;

    const a = tick(SPAN, withRoster, seededRng());
    const b = tick(SPAN, withoutRoster as GameState, seededRng());

    // Strip the roster fields off `a` and the results must be byte-identical: the tick never reads them.
    const { personnelRosters: _pr, nextRosterId: _nr, ...aStripped } = a as any;
    expect(aStripped).toEqual(b);
    // And the tick left the roster fields themselves untouched.
    expect(a.personnelRosters).toEqual(withRoster.personnelRosters);
    expect(a.nextRosterId).toBe(withRoster.nextRosterId);
  });
});

// ============================================================================
// Favoriting (Crew 0.14.0 GL): toggleNotableFavorite
// ============================================================================

describe("toggleNotableFavorite", () => {
  it("flips a notable's favorite on then off (absent reads as false)", () => {
    const s0 = stateWith({ notableCrew: [notable({ id: "notable-1" })] });
    expect(s0.notableCrew[0].favorite).toBeUndefined();

    const s1 = toggleNotableFavorite(s0, "notable-1");
    expect(s1).not.toBe(s0); // fresh state
    expect(s1.notableCrew[0].favorite).toBe(true);

    const s2 = toggleNotableFavorite(s1, "notable-1");
    expect(s2.notableCrew[0].favorite).toBe(false);

    // Pure: the input state/notable is never mutated.
    expect(s0.notableCrew[0].favorite).toBeUndefined();
  });

  it("is a same-ref no-op on an unknown notable id", () => {
    const s0 = stateWith({ notableCrew: [notable({ id: "notable-1" })] });
    expect(toggleNotableFavorite(s0, "notable-404")).toBe(s0);
  });
});
