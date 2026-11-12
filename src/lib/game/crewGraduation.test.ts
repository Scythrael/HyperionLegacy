// CP-8 (docs/plans/2026-10-14-complement-and-acquisition-plan.md, E-CREW Task 26 engine) and OC-11.
// Covers: graduation drops the bucket by one and adds a named notable aboard the same ship with the same signature
// (identity only: headcount, caps and the crew map unchanged); the fleet-wide notable cap (OC-8); the lock, a missing
// ship and a missing bucket refuse with the SAME reference; send back unassigns and keeps the name (OC-9); the manifest
// is pure, stable and paged; resolveCrew counts assigned notables as occupants (B23) and pauses a passive ship that is
// crew-locked (OC-11), filling it once it is free.
import { describe, it, expect } from "vitest";
import { freshState, NOTABLE_CREW_CAP } from "./model";
import type { CaptainMissionState, CrewBucket, CrewProfession, Expedition, GameState, NotableCrewMember } from "./model";
import {
  MANIFEST_NAME_SALT,
  NOTABLE_NAME_SALT,
  canGraduate,
  canRetireNotable,
  canSendBackNotable,
  graduateBlockText,
  graduateGateText,
  graduateStandout,
  manifestRows,
  nextGraduateIdentity,
  retireBlockText,
  retireGateText,
  retireNotable,
  sendBackBlockText,
  sendBackGateText,
  sendBackNotable,
} from "./crewGraduation";
import { signatureKey, totalCrew } from "./crew";
import { CREW_PROFESSIONS, complementTotalCap, countAtRankOrHigher, countInDivision, divisionCap, inclusiveRankCap } from "./commandStructure";
import { CREW_RANK_ORDER } from "./crewRank";
import { resolveCrew, shipCrewContribution } from "./crewOverlay";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { homeworldReserveCount } from "./homeworldReserve";

const HULL = "generalFreighter" as const;

function bucket(profession: CrewProfession, count: number, rank: CrewBucket["rank"] = 1, buff1Id = "ops.unloadSpeed"): CrewBucket {
  return { profession, rarity: "standard", rank, race: "spacer", buff1Id, buff2Id: null, count };
}

function withComplement(buckets: CrewBucket[], mode: "active" | "passive" = "passive", pool: CrewBucket[] = []): GameState {
  const base = freshState();
  return { ...base, crewPool: pool, ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode } } : sh)) };
}

function activeMission(): CaptainMissionState {
  return { kind: "extraction", missionKey: "shortOreRun", phase: "transitOut", phaseProgressTicks: 0, cargo: {} as CaptainMissionState["cargo"], recalled: false };
}
const onMission = (s: GameState): GameState => ({ ...s, captains: s.captains.map((c) => (c.id === 1 ? { ...c, mission: activeMission() } : c)) });
const onExpedition = (s: GameState, phase: Expedition["phase"] = "transit"): GameState => ({
  ...s,
  expeditions: [...s.expeditions, { id: "expedition-ship-1", shipId: "ship-1", phase } as unknown as Expedition],
});

function notable(id: string, b: CrewBucket, shipId: string | null): NotableCrewMember {
  return { id, profession: b.profession, rarity: b.rarity, rank: b.rank, race: b.race, buff1Id: b.buff1Id, buff2Id: b.buff2Id, name: `N ${id}`, gender: "female", assignedShipId: shipId };
}

const bulk = (s: GameState): CrewBucket[] => s.ships[0].complement?.buckets ?? [];

describe("CP-8 graduate", () => {
  it("drops the bucket by one and adds a named notable aboard the same ship with the same signature", () => {
    const ops = bucket("operations", 5, 3);
    const s = withComplement([ops, bucket("engineering", 2, 1, "eng.range")]);
    const out = graduateStandout(s, "ship-1", signatureKey(ops));
    expect(out.gate).toEqual({ ok: true });
    expect(bulk(out.next)[0].count).toBe(4);
    expect(bulk(out.next)[1]).toEqual(bulk(s)[1]);
    const n = out.notable!;
    expect(out.next.notableCrew).toEqual([n]);
    expect(n.id).toBe("notable-1");
    expect(n.assignedShipId).toBe("ship-1");
    expect(signatureKey(n)).toBe(signatureKey(ops));
    expect(n.name).toBe(nextGraduateIdentity(s, ops).name);
    expect(n.name.length).toBeGreaterThan(0);
    expect(out.next.nextNotableId).toBe(2);
    // the input is never mutated
    expect(bulk(s)[0].count).toBe(5);
    expect(s.notableCrew).toEqual([]);
  });

  it("identity only: the ship's crew map is unchanged by the move (one notable counts as one crew of its group)", () => {
    const ops = bucket("operations", 20);
    const s = withComplement([ops, bucket("engineering", 4, 1, "eng.range")]);
    const before = shipCrewContribution(s, s.ships[0]);
    const out = graduateStandout(s, "ship-1", signatureKey(ops)).next;
    const after = shipCrewContribution(out, out.ships[0]);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const k of Object.keys(before)) expect(after[k]).toBeCloseTo(before[k], 12);
  });

  it("prunes the bucket at zero and keeps the complement's mode", () => {
    const one = bucket("operations", 1, 5);
    const s = withComplement([one], "active");
    const out = graduateStandout(s, "ship-1", signatureKey(one)).next;
    expect(bulk(out)).toEqual([]);
    expect(out.ships[0].complement!.mode).toBe("active");
  });

  it("two graduates of one bucket get distinct ids and are named by the bucket and the id", () => {
    const ops = bucket("operations", 5);
    const s = withComplement([ops]);
    const a = graduateStandout(s, "ship-1", signatureKey(ops)).next;
    const b = graduateStandout(a, "ship-1", signatureKey(ops)).next;
    expect(b.notableCrew.map((n) => n.id)).toEqual(["notable-1", "notable-2"]);
    expect(bulk(b)[0].count).toBe(3);
    // deterministic: the same inputs give the same names
    expect(graduateStandout(s, "ship-1", signatureKey(ops)).notable!.name).toBe(a.notableCrew[0].name);
  });

  it("refuses with the SAME reference: no ship, no such bucket, a crew-locked ship, the fleet-wide cap", () => {
    const ops = bucket("operations", 5);
    const s = withComplement([ops]);
    const k = signatureKey(ops);
    const cases: [GameState, string, string, string][] = [
      [s, "ship-404", k, "noShip"],
      [s, "ship-1", signatureKey(bucket("science", 1, 1, "sci.rareFind")), "noBucket"],
      [onMission(s), "ship-1", k, "onMission"],
      [onExpedition(s, "complete"), "ship-1", k, "onMission"],
      [{ ...s, notableCrew: Array.from({ length: NOTABLE_CREW_CAP }, (_, i) => notable(`notable-x${i}`, ops, null)) }, "ship-1", k, "notableCap"],
    ];
    for (const [state, shipId, key, reason] of cases) {
      expect(canGraduate(state, shipId, key)).toEqual({ ok: false, reason });
      const out = graduateStandout(state, shipId, key);
      expect(out.next).toBe(state);
      expect(out.notable).toBeNull();
    }
    // one under the cap still graduates
    const under = { ...s, notableCrew: Array.from({ length: NOTABLE_CREW_CAP - 1 }, (_, i) => notable(`notable-x${i}`, ops, null)) };
    expect(graduateStandout(under, "ship-1", k).next.notableCrew).toHaveLength(NOTABLE_CREW_CAP);
  });

  it("the cap is the user's 50 fleet-wide (OC-8)", () => {
    expect(NOTABLE_CREW_CAP).toBe(50);
  });

  it("refusal text names the real lock", () => {
    const ops = bucket("operations", 5);
    const k = signatureKey(ops);
    const s = withComplement([ops]);
    expect(graduateGateText(onMission(s), "ship-1", canGraduate(onMission(s), "ship-1", k))).toBe("Ship is out on a mission");
    expect(graduateGateText(onExpedition(s), "ship-1", canGraduate(onExpedition(s), "ship-1", k))).toBe("Ship is on an expedition");
    expect(graduateGateText(s, "ship-1", canGraduate(s, "ship-1", k))).toBeUndefined();
    const banned = [String.fromCharCode(0x2014), "-".repeat(2)];
    for (const r of ["noShip", "onMission", "noBucket", "notableCap"] as const) {
      for (const b of banned) expect(graduateBlockText(r).includes(b)).toBe(false);
    }
    expect(graduateBlockText("notableCap")).toBe("The fleet already has 50 notable crew. Retire one to make room");
  });

  it("uses its own odd salts", () => {
    expect(NOTABLE_NAME_SALT % 2).toBe(1);
    expect(MANIFEST_NAME_SALT % 2).toBe(1);
    expect(NOTABLE_NAME_SALT).not.toBe(MANIFEST_NAME_SALT);
  });
});

describe("CP-8 send back (OC-9: unassign, stays named)", () => {
  it("unassigns the notable and keeps its record", () => {
    const ops = bucket("operations", 5);
    const s = graduateStandout(withComplement([ops]), "ship-1", signatureKey(ops)).next;
    const id = s.notableCrew[0].id;
    expect(canSendBackNotable(s, id)).toEqual({ ok: true });
    const out = sendBackNotable(s, id);
    expect(out.notableCrew).toEqual([{ ...s.notableCrew[0], assignedShipId: null }]);
    expect(out.ships).toBe(s.ships);
  });

  it("refuses with the SAME reference: unknown, not aboard, crew-locked", () => {
    const ops = bucket("operations", 5);
    const s = withComplement([ops]);
    const aboard = { ...s, notableCrew: [notable("notable-1", ops, "ship-1"), notable("notable-2", ops, null)] };
    const cases: [GameState, string, string][] = [
      [aboard, "notable-9", "noNotable"],
      [aboard, "notable-2", "notAboard"],
      [onMission(aboard), "notable-1", "onMission"],
      [onExpedition(aboard), "notable-1", "onMission"],
    ];
    for (const [state, id, reason] of cases) {
      expect(canSendBackNotable(state, id)).toEqual({ ok: false, reason });
      expect(sendBackNotable(state, id)).toBe(state);
    }
    expect(sendBackGateText(onExpedition(aboard), "notable-1", canSendBackNotable(onExpedition(aboard), "notable-1"))).toBe("Ship is on an expedition");
    for (const r of ["noNotable", "notAboard", "onMission"] as const) expect(sendBackBlockText(r).length).toBeGreaterThan(0);
  });
});

describe("CP-9 retire (user call 2026-11-02)", () => {
  it("removes an aboard notable: the ship's crew drops by that one, a cap slot frees, ids are never reused", () => {
    const ops = bucket("operations", 5);
    const s = graduateStandout(withComplement([ops], "active"), "ship-1", signatureKey(ops)).next;
    const id = s.notableCrew[0].id;
    expect(canRetireNotable(s, id)).toEqual({ ok: true });
    const out = retireNotable(s, id);
    expect(out.notableCrew).toEqual([]);
    expect(out.ships).toBe(s.ships);
    expect(bulk(out)[0].count).toBe(4);
    expect(out.nextNotableId).toBe(s.nextNotableId);
    expect(out.personnelRosters).toBe(s.personnelRosters);
    // the input is never mutated
    expect(s.notableCrew.length).toBe(1);
  });

  it("works for an unassigned notable and frees a slot under the fleet cap", () => {
    const ops = bucket("operations", 5);
    const full: GameState = { ...withComplement([ops]), notableCrew: Array.from({ length: NOTABLE_CREW_CAP }, (_, i) => notable(`notable-x${i}`, ops, null)) };
    expect(canGraduate(full, "ship-1", signatureKey(ops))).toEqual({ ok: false, reason: "notableCap" });
    const out = retireNotable(full, "notable-x7");
    expect(out.notableCrew.length).toBe(NOTABLE_CREW_CAP - 1);
    expect(out.notableCrew.some((n) => n.id === "notable-x7")).toBe(false);
    expect(canGraduate(out, "ship-1", signatureKey(ops))).toEqual({ ok: true });
  });

  it("drops the id from every roster's pins, leaving other pins in order", () => {
    const ops = bucket("operations", 5);
    const base = withComplement([ops]);
    const roster = (id: string, pins: string[]) => ({ id, name: id, linkedLoadoutId: null, includePeople: true, seatAssignments: {}, pinnedNotableCrew: pins });
    const s: GameState = {
      ...base,
      notableCrew: [notable("notable-1", ops, null), notable("notable-2", ops, null)],
      personnelRosters: [roster("roster-1", ["notable-2", "notable-1"]), roster("roster-2", ["notable-2"])],
    };
    const out = retireNotable(s, "notable-1");
    expect(out.personnelRosters[0].pinnedNotableCrew).toEqual(["notable-2"]);
    expect(out.personnelRosters[1]).toBe(s.personnelRosters[1]);
  });

  it("a passive ship refills the freed berth on the tick, the same as after Send back", () => {
    const ops = bucket("operations", 3);
    const s: GameState = { ...withComplement([ops], "passive", [bucket("operations", 100)]), notableCrew: [notable("notable-1", ops, "ship-1")] };
    const filled = resolveCrew(s);
    const retired = resolveCrew(retireNotable(filled, "notable-1"));
    const sentBack = resolveCrew(sendBackNotable(filled, "notable-1"));
    expect(bulk(retired)).toEqual(bulk(sentBack));
    expect(totalCrew(bulk(retired))).toBe(totalCrew(bulk(filled)) + 1);
  });

  it("refuses with the SAME reference: unknown, or aboard a crew-locked ship (an unassigned one still retires)", () => {
    const ops = bucket("operations", 5);
    const aboard = { ...withComplement([ops]), notableCrew: [notable("notable-1", ops, "ship-1"), notable("notable-2", ops, null)] };
    const cases: [GameState, string, string][] = [
      [aboard, "notable-9", "noNotable"],
      [onMission(aboard), "notable-1", "onMission"],
      [onExpedition(aboard), "notable-1", "onMission"],
    ];
    for (const [state, id, reason] of cases) {
      expect(canRetireNotable(state, id)).toEqual({ ok: false, reason });
      expect(retireNotable(state, id)).toBe(state);
    }
    expect(canRetireNotable(onMission(aboard), "notable-2")).toEqual({ ok: true });
    expect(retireGateText(onExpedition(aboard), "notable-1", canRetireNotable(onExpedition(aboard), "notable-1"))).toBe("Ship is on an expedition");
    expect(retireGateText(aboard, "notable-1", canRetireNotable(aboard, "notable-1"))).toBeUndefined();
    for (const r of ["noNotable", "onMission"] as const) expect(retireBlockText(r).length).toBeGreaterThan(0);
  });
});

describe("CP-8 manifest (pure paged generator)", () => {
  const a = bucket("operations", 3, 2);
  const b = bucket("engineering", 4, 1, "eng.range");
  const s = withComplement([a, b]);

  it("lists every head of the bulk, bucket by bucket, with a total", () => {
    const page = manifestRows(s, "ship-1", 0, 100);
    expect(page.total).toBe(7);
    expect(page.rows.map((r) => [r.index, r.signatureKey, r.rowInBucket])).toEqual([
      [0, signatureKey(a), 0],
      [1, signatureKey(a), 1],
      [2, signatureKey(a), 2],
      [3, signatureKey(b), 0],
      [4, signatureKey(b), 1],
      [5, signatureKey(b), 2],
      [6, signatureKey(b), 3],
    ]);
    expect(page.rows[3]).toMatchObject({ profession: "engineering", rank: 1, buff1Id: "eng.range", race: "spacer" });
  });

  it("is stable across calls and pages concatenate to the whole", () => {
    const whole = manifestRows(s, "ship-1", 0, 100).rows;
    expect(manifestRows(s, "ship-1", 0, 100).rows).toEqual(whole);
    const paged = [...manifestRows(s, "ship-1", 0, 2).rows, ...manifestRows(s, "ship-1", 2, 3).rows, ...manifestRows(s, "ship-1", 5, 10).rows];
    expect(paged).toEqual(whole);
    expect(new Set(whole.map((r) => r.name)).size).toBeGreaterThan(1);
  });

  it("is never stored and does not touch state", () => {
    const json = JSON.stringify(s);
    manifestRows(s, "ship-1", 0, 100);
    expect(JSON.stringify(s)).toBe(json);
  });

  it("a row keeps its name while its bucket holds it (graduating one trims the tail)", () => {
    const before = manifestRows(s, "ship-1", 0, 100).rows.filter((r) => r.signatureKey === signatureKey(b));
    const after = manifestRows(graduateStandout(s, "ship-1", signatureKey(b)).next, "ship-1", 0, 100).rows.filter((r) => r.signatureKey === signatureKey(b));
    expect(after.map((r) => r.name)).toEqual(before.slice(0, 3).map((r) => r.name));
  });

  it("an unknown ship, a negative offset and a zero limit give what they can", () => {
    expect(manifestRows(s, "ship-404", 0, 10)).toEqual({ rows: [], total: 0 });
    expect(manifestRows(s, "ship-1", -5, 2).rows.map((r) => r.index)).toEqual([0, 1]);
    expect(manifestRows(s, "ship-1", 0, 0)).toEqual({ rows: [], total: 7 });
    expect(manifestRows(s, "ship-1", 50, 10).rows).toEqual([]);
  });

  it("CP-9: a division filter narrows the rows and the total, and every name stays the unfiltered one", () => {
    const whole = manifestRows(s, "ship-1", 0, 100).rows;
    const eng = manifestRows(s, "ship-1", 0, 100, "engineering");
    expect(eng.total).toBe(4);
    expect(eng.rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(eng.rows.map((r) => [r.signatureKey, r.rowInBucket, r.name])).toEqual(
      whole.filter((r) => r.profession === "engineering").map((r) => [r.signatureKey, r.rowInBucket, r.name]),
    );
    expect(manifestRows(s, "ship-1", 1, 2, "engineering").rows.map((r) => r.rowInBucket)).toEqual([1, 2]);
    expect(manifestRows(s, "ship-1", 0, 100, "medical")).toEqual({ rows: [], total: 0 });
    expect(manifestRows(s, "ship-1", 0, 100, null)).toEqual(manifestRows(s, "ship-1", 0, 100));
  });

  it("a 750-head manifest pages fast", () => {
    const big = withComplement([bucket("operations", 400), bucket("engineering", 350, 1, "eng.range")]);
    const t0 = performance.now();
    const page = manifestRows(big, "ship-1", 700, 50);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(page.rows).toHaveLength(50);
    expect(page.rows[49].index).toBe(749);
  });
});

// The auto-crew (resolveCrew) rules CP-8 owns: assigned notables hold their slots (B23), and OC-11 pauses a passive
// ship that is crew-locked.
describe("CP-8 / OC-11 auto-crew", () => {
  const dueAt = { gameTimeSeconds: TRANSPORT_WINDOW_SECONDS + 1 };

  function capsHold(s: GameState): void {
    const ship = s.ships[0];
    const occ = [...(ship.complement?.buckets ?? []), ...s.notableCrew.filter((n) => n.assignedShipId === ship.id).map((n) => ({ ...n, count: 1 }))];
    expect(totalCrew(occ)).toBeLessThanOrEqual(complementTotalCap(HULL));
    for (const p of CREW_PROFESSIONS) {
      expect(countInDivision(occ, p)).toBeLessThanOrEqual(divisionCap(HULL, p));
      for (const t of CREW_RANK_ORDER) expect(countAtRankOrHigher(occ, p, t)).toBeLessThanOrEqual(inclusiveRankCap(HULL, p, t));
    }
  }

  it("a passive ship with assigned notables never exceeds its caps (notables + bulk)", () => {
    const pool = CREW_PROFESSIONS.flatMap((p) => CREW_RANK_ORDER.map((r) => bucket(p, 40, r, `${p}.x`)));
    // The highest rank the freighter's Operations division has room for, so the notable is a legal occupant.
    const topRank = [...CREW_RANK_ORDER].reverse().find((r) => inclusiveRankCap(HULL, "operations", r) > 0)!;
    const top = bucket("operations", 1, topRank, "ops.unloadSpeed");
    let s: GameState = { ...withComplement([], "passive", pool), notableCrew: [notable("notable-1", top, "ship-1"), notable("notable-2", bucket("engineering", 1, 1, "eng.range"), "ship-1")] };
    expect(topRank).toBeGreaterThan(1);
    s = resolveCrew(s);
    capsHold(s);
    // it filled to the total cap exactly, counting the two notables
    expect(totalCrew(bulk(s)) + 2).toBe(complementTotalCap(HULL));
    // the bulk holds no notable slot (notables are their own records)
    expect(bulk(s).some((b) => signatureKey(b) === signatureKey(top))).toBe(false);
  });

  it("a notable sharing a bulk signature is stripped back out of the bulk exactly once", () => {
    const ops = bucket("operations", 3);
    let s: GameState = { ...withComplement([ops], "passive", [bucket("operations", 100)]), notableCrew: [notable("notable-1", ops, "ship-1")] };
    s = resolveCrew(s);
    capsHold(s);
    // Homeworld reserve (user 2026-11-12): the pool's surplus no berth can take now moves on to the reserve; nobody is lost.
    const conserved = totalCrew(bulk(s)) + totalCrew(s.crewPool) + homeworldReserveCount(s);
    expect(conserved).toBe(103);
    expect(totalCrew(bulk(s)) + 1).toBe(Math.min(divisionCap(HULL, "operations"), inclusiveRankCap(HULL, "operations", 1), complementTotalCap(HULL)));
  });

  it("without notables the fill is the pre-CP-8 fill", () => {
    const pool = [bucket("operations", 100), bucket("engineering", 100, 1, "eng.range")];
    const s = withComplement([], "passive", pool);
    const withStranger = { ...s, notableCrew: [notable("notable-1", bucket("science", 1, 1, "sci.rareFind"), null)] };
    expect(bulk(resolveCrew(withStranger))).toEqual(bulk(resolveCrew(s)));
  });

  it("OC-11: a passive ship out on a mission or an unclaimed expedition takes no crew; it fills once free", () => {
    const pool = [bucket("operations", 10)];
    const home = { ...withComplement([], "passive", pool), ...dueAt };
    for (const out of [onMission(home), onExpedition(home), onExpedition(home, "complete")]) {
      const next = resolveCrew(out);
      expect(next.ships).toBe(out.ships);
      expect(totalCrew(next.crewPool)).toBeGreaterThanOrEqual(10);
      // the transport still lands in the pool while the ship is out
      expect(next.lastTransportWindow).toBe(1);
    }
    expect(totalCrew(bulk(resolveCrew(home)))).toBeGreaterThan(0);
  });

  it("OC-11: an idle passive ship beside one that is out still fills", () => {
    const base = withComplement([], "passive", [bucket("operations", 10)]);
    const s: GameState = {
      ...base,
      ships: [...base.ships, { ...base.ships[0], id: "ship-2", assignedCaptainId: null, complement: { buckets: [], mode: "passive" } }],
    };
    const next = resolveCrew(onMission(s));
    expect(totalCrew(bulk(next))).toBe(0);
    // ship-2 takes exactly what ship-1 would have taken alone (the same hull)
    expect(totalCrew(next.ships[1].complement!.buckets)).toBe(totalCrew(bulk(resolveCrew(base))));
    expect(totalCrew(next.ships[1].complement!.buckets)).toBeGreaterThan(0);
  });
});
