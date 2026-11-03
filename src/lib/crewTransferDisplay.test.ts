// CP-10 (docs/plans/2026-10-14-complement-and-acquisition-plan.md; signed mockup
// docs/mockups/2026-11-02-cp10-transfer-picker-mockup.html): the transfer picker's display logic. Every number the
// picker shows must equal what the ONE engine (crewTransfer.ts transferCrew) does: the destination cards (room, mode,
// lock, full), each row's warning and willMove, the summary and the button, the row-by-row result, "Transfer more",
// and the crew pool view's division stats. Plus the pool manifest (crewGraduation.ts manifestRows on "pool").
import { describe, it, expect } from "vitest";
import { freshState } from "./game/model";
import type { CrewBucket, CrewProfession, Expedition, GameState, NotableCrewMember } from "./game/model";
import { CREW_POOL, transferCrew } from "./game/crewTransfer";
import { signatureKey } from "./game/crew";
import { CREW_PROFESSIONS, complementTotalCap, divisionCap, inclusiveRankCap } from "./game/commandStructure";
import { emptyGroundTeams } from "./game/groundTeams";
import { MANIFEST_POOL_ID, manifestRows } from "./game/crewGraduation";
import { manifestView } from "./complementTableDisplay";
import {
  availableAt,
  clampPickCount,
  defaultDestination,
  fmtCount,
  initialTransferPicks,
  picksAfterTransfer,
  poolDivisionStats,
  poolHeadcount,
  transferDestinations,
  transferLogLine,
  transferPreview,
  transferResultView,
  transferSourceBlock,
} from "./crewTransferDisplay";

const HULL = "generalFreighter" as const;

function bucket(profession: CrewProfession, count: number, rank: CrewBucket["rank"] = 1, buff1Id = `${profession}.b`): CrewBucket {
  return { profession, rarity: "standard", rank, race: "spacer", buff1Id, buff2Id: null, count };
}

// ship-1 (freshState's freighter) and ship-2 / ship-3 (parked freighters), all MANUAL and empty, with the given pool.
function fleet(pool: CrewBucket[] = []): GameState {
  const base = freshState();
  const parked = (id: string) => ({
    id,
    typeKey: HULL,
    assignedCaptainId: null,
    complement: { buckets: [] as CrewBucket[], mode: "active" as const },
    groundTeams: emptyGroundTeams(HULL),
  });
  return {
    ...base,
    crewPool: pool,
    ships: [{ ...base.ships[0], complement: { buckets: [], mode: "active" } }, parked("ship-2"), parked("ship-3")],
  };
}

function withComplement(s: GameState, shipId: string, buckets: CrewBucket[], mode: "active" | "passive" = "active"): GameState {
  return { ...s, ships: s.ships.map((sh) => (sh.id === shipId ? { ...sh, complement: { buckets, mode } } : sh)) };
}

function onExpedition(s: GameState, shipId: string): GameState {
  return { ...s, expeditions: [...s.expeditions, { id: `expedition-${shipId}`, shipId, phase: "transit" } as unknown as Expedition] };
}

function notable(id: string, profession: CrewProfession, shipId: string | null): NotableCrewMember {
  return {
    id,
    name: `Notable ${id}`,
    profession,
    rarity: "standard",
    rank: 1,
    race: "spacer",
    buff1Id: `${profession}.b`,
    buff2Id: null,
    assignedShipId: shipId,
  } as NotableCrewMember;
}

const k = signatureKey;

describe("fmtCount", () => {
  it("groups thousands the US way", () => {
    expect(fmtCount(1284)).toBe("1,284");
    expect(fmtCount(0)).toBe("0");
  });
});

describe("transferSourceBlock", () => {
  it("is null for the pool and a manual ship that is home", () => {
    const s = fleet();
    expect(transferSourceBlock(s, CREW_POOL)).toBeNull();
    expect(transferSourceBlock(s, "ship-2")).toBeNull();
  });
  it("names the lock, and offers manual for an auto-crew source", () => {
    const s = onExpedition(withComplement(fleet(), "ship-3", [], "passive"), "ship-2");
    expect(transferSourceBlock(s, "ship-2")).toEqual({
      kind: "locked",
      text: "Ship is on an expedition: crew changes are locked until its expedition is claimed",
    });
    const auto = transferSourceBlock(s, "ship-3");
    expect(auto?.kind).toBe("autoCrew");
    expect(auto?.text).toMatch(/is on auto-crew\. Switch it to manual crew first/);
  });
});

describe("transferDestinations", () => {
  it("lists the pool first, then every other ship, never the source", () => {
    const s = fleet([bucket("science", 1284)]);
    const cards = transferDestinations(s, "ship-1");
    expect(cards.map((c) => c.id)).toEqual([CREW_POOL, "ship-2", "ship-3"]);
    expect(cards[0].line).toBe("no cap · 1,284 waiting");
    // From the pool, the pool is not a destination.
    expect(transferDestinations(s, CREW_POOL).map((c) => c.id)).toEqual(["ship-1", "ship-2", "ship-3"]);
  });

  it("shows the berths and the room on a manual ship (notables aboard count)", () => {
    const cap = complementTotalCap(HULL);
    let s = withComplement(fleet(), "ship-2", [bucket("engineering", 3)]);
    s = { ...s, notableCrew: [notable("n1", "engineering", "ship-2")] };
    const card = transferDestinations(s, "ship-1").find((c) => c.id === "ship-2")!;
    expect(card.status).toBe("ok");
    expect(card.pickable).toBe(true);
    expect(card.mode).toBe("manual");
    expect(card.line).toBe(`4 / ${cap} berths · room for ${cap - 4}`);
    expect(card.shortLine).toBe(`4 / ${cap} · room for ${cap - 4}`);
  });

  it("an auto-crew ship offers the switch; a locked one says why; a full one cannot be picked", () => {
    const cap = complementTotalCap(HULL);
    const full: CrewBucket[] = [];
    // Fill ship-3 to its total exactly, division by division at Crewman.
    let left = cap;
    for (const p of CREW_PROFESSIONS) {
      const n = Math.min(left, divisionCap(HULL, p), inclusiveRankCap(HULL, p, 1));
      if (n > 0) full.push(bucket(p, n));
      left -= n;
    }
    let s = withComplement(fleet(), "ship-3", full);
    s = withComplement(s, "ship-1", [], "passive");
    s = onExpedition(s, "ship-2");
    const cards = transferDestinations(s, CREW_POOL);
    const auto = cards.find((c) => c.id === "ship-1")!;
    expect(auto.status).toBe("autoCrew");
    expect(auto.pickable).toBe(false);
    expect(auto.canSwitchToManual).toBe(true);
    expect(auto.warn).toBe("Switch the ship to manual crew first.");
    const locked = cards.find((c) => c.id === "ship-2")!;
    expect(locked.status).toBe("locked");
    expect(locked.canSwitchToManual).toBe(false);
    expect(locked.warn).toBe("Ship is on an expedition: crew locked until its expedition is claimed.");
    expect(locked.shortWarn).toBe("On an expedition until claimed.");
    const fullCard = cards.find((c) => c.id === "ship-3")!;
    if (left === 0) {
      expect(fullCard.status).toBe("full");
      expect(fullCard.pickable).toBe(false);
      expect(fullCard.line).toBe(`${cap} / ${cap} berths · full, takes no more crew`);
    }
    expect(defaultDestination(cards)).toBeNull();
  });

  it("a ship over its cap reads over cap and is never pickable (OC-6)", () => {
    const cap = complementTotalCap(HULL);
    const s = withComplement(fleet(), "ship-2", [bucket("operations", cap + 3)]);
    const card = transferDestinations(s, "ship-1").find((c) => c.id === "ship-2")!;
    expect(card.status).toBe("full");
    expect(card.line).toBe(`${cap + 3} / ${cap} berths · over cap, takes no more crew`);
  });

  it("starts on the first pickable card", () => {
    const s = fleet();
    expect(defaultDestination(transferDestinations(s, "ship-1"))).toBe(CREW_POOL);
    expect(defaultDestination(transferDestinations(s, CREW_POOL))).toBe("ship-1");
  });
});

describe("picks and steppers", () => {
  it("starts every picked group whole and drops groups that are gone", () => {
    const a = bucket("science", 5);
    const s = withComplement(fleet(), "ship-1", [a]);
    expect(initialTransferPicks(s, "ship-1", [k(a), "gone"])).toEqual([{ signatureKey: k(a), count: 5 }]);
    expect(availableAt(s, "ship-1", k(a))).toBe(5);
  });
  it("clamps a typed count to a whole number within what the group has", () => {
    expect(clampPickCount(7.8, 5)).toBe(5);
    expect(clampPickCount(-2, 5)).toBe(0);
    expect(clampPickCount(Number.NaN, 5)).toBe(0);
    expect(clampPickCount(3.9, 5)).toBe(3);
  });
});

describe("transferPreview", () => {
  it("every row moves in full to the pool, and the summary names the source berths", () => {
    const a = bucket("science", 3);
    const b = bucket("security", 2, 1, "security.x");
    const s = withComplement(fleet(), "ship-1", [a, b]);
    const p = transferPreview(s, "ship-1", CREW_POOL, [
      { signatureKey: k(a), count: 3 },
      { signatureKey: k(b), count: 2 },
    ]);
    expect(p.asked).toBe(5);
    expect(p.willMove).toBe(5);
    expect(p.stay).toBe(0);
    expect(p.rows.map((r) => r.note)).toEqual(["ok", "ok"]);
    expect(p.rows[0].noteText).toBe("Room for all 3.");
    expect(p.buttonLabel).toBe("Transfer 5");
    expect(p.summary.startsWith("Moving 5 to Crew pool.")).toBe(true);
    expect(p.summary).toContain(`goes from 5 to 0 / ${complementTotalCap(HULL)}.`);
  });

  it("warns on a row that asks for more than there is room for, and the button shows what will move (pick 2)", () => {
    const divCap = divisionCap(HULL, "science");
    const room = 2;
    // ship-2 holds all but `room` of its Science division.
    let s = withComplement(fleet(), "ship-2", [bucket("science", divCap - room, 1, "science.held")]);
    const a = bucket("science", room + 3);
    s = withComplement(s, "ship-1", [a]);
    const p = transferPreview(s, "ship-1", "ship-2", [{ signatureKey: k(a), count: room + 3 }]);
    const engine = transferCrew(s, "ship-1", "ship-2", [{ signatureKey: k(a), count: room + 3 }]);
    expect(p.willMove).toBe(engine.moved);
    expect(p.rows[0].willMove).toBe(engine.moved);
    expect(p.rows[0].note).toBe("short");
    expect(p.rows[0].noteText).toMatch(new RegExp(`^Room for ${engine.moved}: .+\\. The other ${room + 3 - engine.moved} stay aboard `));
    expect(p.rows[0].shortNoteText).toBe(`Room for ${engine.moved}. The other ${room + 3 - engine.moved} stay.`);
    expect(p.buttonLabel).toBe(`Transfer ${engine.moved}`);
    expect(p.summary).toContain(`room for ${engine.moved}, ${room + 3 - engine.moved} stay.`);
  });

  it("rows that compete for one cap read exactly what the engine does, in order", () => {
    const divCap = divisionCap(HULL, "engineering");
    let s = withComplement(fleet(), "ship-2", [bucket("engineering", divCap - 3, 1, "engineering.held")]);
    const a = bucket("engineering", 2, 1, "engineering.a");
    const b = bucket("engineering", 2, 1, "engineering.b2");
    s = withComplement(s, "ship-1", [a, b]);
    const picks = [
      { signatureKey: k(a), count: 2 },
      { signatureKey: k(b), count: 2 },
    ];
    const p = transferPreview(s, "ship-1", "ship-2", picks);
    const engine = transferCrew(s, "ship-1", "ship-2", picks);
    expect(p.rows.map((r) => r.willMove)).toEqual(engine.results.map((r) => r.moved));
    expect(p.willMove).toBe(engine.moved);
  });

  it("a short row's reason reads the berths when that row was applied, not after later rows fill the ship", () => {
    const total = complementTotalCap(HULL);
    const sciCap = divisionCap(HULL, "science");
    // ship-2: Science has room for 2; the ship has 5 berths left, so row 2 (Engineering) takes the last 3 after row 1.
    const held: CrewBucket[] = [bucket("science", sciCap - 2, 1, "science.held")];
    let need = total - 5 - (sciCap - 2);
    for (const prof of ["engineering", ...CREW_PROFESSIONS.filter((x) => x !== "science" && x !== "engineering")] as CrewProfession[]) {
      if (need <= 0) break;
      const room = divisionCap(HULL, prof) - (prof === "engineering" ? 3 : 0);
      const n = Math.min(need, room);
      if (n > 0) held.push(bucket(prof, n, 1, `${prof}.held`));
      need -= n;
    }
    expect(need).toBe(0);
    let s = withComplement(fleet(), "ship-2", held);
    const sci = bucket("science", 4, 1, "science.a");
    const eng = bucket("engineering", 3, 1, "engineering.a");
    s = withComplement(s, "ship-1", [sci, eng]);
    const picks = [
      { signatureKey: k(sci), count: 4 },
      { signatureKey: k(eng), count: 3 },
    ];
    const engine = transferCrew(s, "ship-1", "ship-2", picks);
    expect(engine.results.map((r) => r.moved)).toEqual([2, 3]);
    const p = transferPreview(s, "ship-1", "ship-2", picks);
    expect(p.rows[0].note).toBe("short");
    expect(p.rows[0].noteText).toContain("Science division is full");
    expect(p.rows[0].noteText).not.toContain("no berths left");
    expect(p.rows[1].note).toBe("ok");
  });

  it("two groups that read the same name their buffs; a lone group does not", () => {
    const a = bucket("science", 2, 1, "science.a");
    const b = bucket("science", 3, 1, "science.b2");
    const c = bucket("medical", 1);
    const s = withComplement(fleet(), "ship-1", [a, b, c]);
    const p = transferPreview(s, "ship-1", CREW_POOL, [
      { signatureKey: k(a), count: 2 },
      { signatureKey: k(b), count: 3 },
      { signatureKey: k(c), count: 1 },
    ]);
    expect(p.rows[0].buffsText).not.toBeNull();
    expect(p.rows[1].buffsText).not.toBeNull();
    expect(p.rows[0].buffsText).not.toBe(p.rows[1].buffsText);
    expect(p.rows[2].buffsText).toBeNull();
  });

  it("a row of 0 is not sent to the engine and reads no note", () => {
    const a = bucket("science", 3);
    const s = withComplement(fleet(), "ship-1", [a]);
    const p = transferPreview(s, "ship-1", CREW_POOL, [{ signatureKey: k(a), count: 0 }]);
    expect(p.willMove).toBe(0);
    expect(p.rows[0].note).toBe("none");
    expect(p.buttonLabel).toBe("Transfer 0");
    expect(p.summary).toBe("Set how many of each group to move.");
  });

  it("from the pool, the summary names the destination ship's berths and the leftovers stay in the pool", () => {
    const a = bucket("medical", 4);
    const s = fleet([a]);
    const p = transferPreview(s, CREW_POOL, "ship-2", [{ signatureKey: k(a), count: 4 }]);
    expect(p.rows[0].availableText).toBe("4 waiting");
    const engine = transferCrew(s, CREW_POOL, "ship-2", [{ signatureKey: k(a), count: 4 }]);
    expect(p.willMove).toBe(engine.moved);
    expect(p.summary).toContain(`goes from 0 to ${engine.moved} / ${complementTotalCap(HULL)}.`);
  });

  it("a refused transfer (a destination that turned auto-crew mid-pick) moves nothing and says why", () => {
    const a = bucket("science", 3);
    const s = withComplement(withComplement(fleet(), "ship-1", [a]), "ship-2", [], "passive");
    const p = transferPreview(s, "ship-1", "ship-2", [{ signatureKey: k(a), count: 3 }]);
    expect(p.willMove).toBe(0);
    expect(p.gateText).toBe("Switch the ship to manual crew first.");
  });

  it("with no destination picked yet, asks for one", () => {
    const a = bucket("science", 3);
    const s = withComplement(fleet(), "ship-1", [a]);
    const p = transferPreview(s, "ship-1", null, [{ signatureKey: k(a), count: 3 }]);
    expect(p.summary).toBe("Pick where the crew go.");
    expect(p.willMove).toBe(0);
  });
});

describe("the result, the log line and Transfer more", () => {
  it("reads row by row, says nobody was lost, and reopens on the leftovers", () => {
    const divCap = divisionCap(HULL, "science");
    let s = withComplement(fleet(), "ship-2", [bucket("science", divCap - 1, 1, "science.held")]);
    const a = bucket("science", 3);
    const b = bucket("security", 2, 1, "security.x");
    s = withComplement(s, "ship-1", [a, b]);
    const picks = [
      { signatureKey: k(a), count: 3 },
      { signatureKey: k(b), count: 2 },
    ];
    const res = transferCrew(s, "ship-1", "ship-2", picks);
    const view = transferResultView(s, "ship-1", "ship-2", res);
    expect(view.heading).toBe(`Moved ${res.moved} of 5 to ${view.heading.split(" to ")[1]}`);
    expect(view.rows[0].label).toBe("Spacer science group, Crewman");
    expect(view.rows[0].short).toBe(true);
    expect(view.rows[0].why).toBe("The destination has no more room for that crew.");
    expect(view.rows[1].short).toBe(false);
    expect(view.footer).toMatch(/^Logged to the fleet log\. Nobody was lost: the 2 without room are still aboard /);
    expect(transferLogLine(s, "ship-1", "ship-2", res)).toMatch(/^Transferred 3 crew from .+ to .+ \(2 stayed: no room\)\.$/);
    expect(picksAfterTransfer(res.next, "ship-1", res)).toEqual([{ signatureKey: k(a), count: 2 }]);
  });

  it("when all moved, Transfer more reopens on what is left of the same groups", () => {
    const a = bucket("science", 5);
    const s = withComplement(fleet(), "ship-1", [a]);
    const res = transferCrew(s, "ship-1", CREW_POOL, [{ signatureKey: k(a), count: 3 }]);
    expect(transferResultView(s, "ship-1", CREW_POOL, res).footer).toBe("Logged to the fleet log.");
    expect(picksAfterTransfer(res.next, "ship-1", res)).toEqual([{ signatureKey: k(a), count: 2 }]);
    expect(transferLogLine(s, "ship-1", CREW_POOL, res)).toMatch(/^Transferred 3 crew from .+ to the crew pool\.$/);
  });
});

describe("the crew pool view", () => {
  it("counts the pool and each division, bars against the largest", () => {
    const s = fleet([bucket("science", 10), bucket("science", 5, 2, "science.c"), bucket("medical", 3)]);
    expect(poolHeadcount(s)).toBe(18);
    const stats = poolDivisionStats(s, CREW_PROFESSIONS);
    expect(stats.find((x) => x.profession === "science")).toMatchObject({ count: 15, barPct: 100, label: "Science" });
    expect(stats.find((x) => x.profession === "medical")).toMatchObject({ count: 3, barPct: 20 });
    expect(stats.find((x) => x.profession === "security")).toMatchObject({ count: 0, barPct: 0 });
  });

  it("the pool has a manifest: every head, pure and stable, no notables", () => {
    const s = { ...fleet([bucket("science", 4), bucket("medical", 2)]), notableCrew: [notable("n1", "science", "ship-1")] };
    const page = manifestRows(s, MANIFEST_POOL_ID, 0, 10);
    expect(page.total).toBe(6);
    expect(page.rows).toHaveLength(6);
    expect(manifestRows(s, MANIFEST_POOL_ID, 0, 10)).toEqual(page);
    const view = manifestView(s, MANIFEST_POOL_ID, 0, null);
    expect(view.total).toBe(6);
    expect(view.notables).toEqual([]);
    expect(view.notableTotal).toBe(0);
  });
});
