// CP-9: the crew groups table, buff chips, selection and the manifest page (complementTableDisplay.ts).
import { describe, it, expect } from "vitest";
import { freshState } from "./game/model";
import type { CrewBucket, GameState, NotableCrewMember } from "./game/model";
import { signatureKey } from "./game/crew";
import { manifestRows } from "./game/crewGraduation";
import {
  MANIFEST_PAGE_SIZE,
  buffChips,
  crewGroupName,
  crewGroupRows,
  divisionGroupCounts,
  filterCrewGroups,
  headerTickState,
  manifestView,
  pagerItems,
  selectionSummary,
  sortCrewGroups,
} from "./complementTableDisplay";

function b(partial: Partial<CrewBucket> & Pick<CrewBucket, "profession" | "count">): CrewBucket {
  return { rarity: "standard", rank: 1, race: "spacer", buff1Id: "ops.unloadSpeed", buff2Id: null, ...partial };
}

const BUCKETS: CrewBucket[] = [
  b({ profession: "operations", count: 22, rank: 2, race: "belter" }),
  b({ profession: "science", count: 1, rank: 8, rarity: "stellar", race: "vael", buff1Id: "sci.rareFind", buff2Id: "excl.missionTurnaround", buff3Id: "sci.survey" }),
  b({ profession: "science", count: 3, rank: 7, rarity: "augmented", race: "earthBorn", buff1Id: "sci.survey", buff2Id: "excl.craftDuplicate", buff3Id: "sci.extraction" }),
  b({ profession: "security", count: 0, rank: 4 }),
  b({ profession: "flightDeck", count: 48, race: "stationBorn", buff1Id: "flight.droneHandling" }),
];

function withShip(buckets: CrewBucket[], notables: NotableCrewMember[] = []): GameState {
  const s = freshState();
  return { ...s, notableCrew: notables, ships: s.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets, mode: "active" } } : sh)) };
}

describe("CP-9 crew groups", () => {
  const rows = crewGroupRows(BUCKETS);

  it("one row per non-empty bucket, named by origin and division", () => {
    expect(rows.map((r) => r.name)).toEqual(["Belter operations group", "Vael science group", "Earth-born science group", "Station-born flight deck group"]);
    expect(rows[1]).toMatchObject({ rankLabel: "Lieutenant Commander", rarityLabel: "Stellar", divisionLabel: "Science", count: 1 });
    expect(rows[0].key).toBe(signatureKey(BUCKETS[0]));
    expect(crewGroupName("earthBorn", "flightDeck")).toBe("Earth-born flight deck group");
  });

  it("two buckets with one signature read as one group (keyed rows never repeat)", () => {
    const twice = crewGroupRows([BUCKETS[0], BUCKETS[4], { ...BUCKETS[0], count: 5 }]);
    expect(twice.map((r) => [r.name, r.count])).toEqual([["Belter operations group", 27], ["Station-born flight deck group", 48]]);
  });

  it("shows EVERY buff: buff1, buff2 and buff3, with the exclusive and held kinds", () => {
    expect(rows[0].buffs.map((c) => c.kind)).toEqual(["profession"]);
    expect(rows[1].buffs.map((c) => [c.label, c.kind])).toEqual([
      ["Keen Analysis", "profession"],
      ["Mission Turnaround", "exclusive"],
      ["Survey Aptitude", "profession"],
    ]);
    expect(rows[2].buffs.map((c) => [c.label, c.kind])).toEqual([
      ["Survey Aptitude", "profession"],
      ["Craft Duplicate Chance (Held for homeworld staffing)", "held"],
      ["Extraction Yield", "profession"],
    ]);
    expect(buffChips({ buff1Id: "med.triage", buff2Id: null })).toHaveLength(1);
  });

  it("sorts by rank, rarity, division and count, stably", () => {
    expect(sortCrewGroups(rows, "rank").map((r) => r.rank)).toEqual([8, 7, 2, 1]);
    expect(sortCrewGroups(rows, "rarity").map((r) => r.rarity)).toEqual(["stellar", "augmented", "standard", "standard"]);
    expect(sortCrewGroups(rows, "division").map((r) => r.profession)).toEqual(["science", "science", "operations", "flightDeck"]);
    expect(sortCrewGroups(rows, "count").map((r) => r.count)).toEqual([48, 22, 3, 1]);
    expect(sortCrewGroups(rows, "rank")).toEqual(sortCrewGroups(sortCrewGroups(rows, "count"), "rank"));
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2, 4]);
  });

  it("filters by division and counts groups per division", () => {
    expect(filterCrewGroups(rows, "science").map((r) => r.name)).toEqual(["Vael science group", "Earth-born science group"]);
    expect(filterCrewGroups(rows, null)).toHaveLength(4);
    const c = divisionGroupCounts(rows);
    expect(c.all).toBe(4);
    expect(c.byDivision).toMatchObject({ science: 2, operations: 1, flightDeck: 1, security: 0 });
  });

  it("the selection bar counts ticked groups and their crew; stale keys are ignored", () => {
    const sel = new Set([rows[1].key, rows[2].key, "gone|key"]);
    expect(selectionSummary(rows, sel)).toEqual({ groups: 2, crew: 4 });
    expect(headerTickState(rows, sel)).toBe("some");
    expect(headerTickState(rows, new Set(rows.map((r) => r.key)))).toBe("all");
    expect(headerTickState(rows, new Set())).toBe("none");
    expect(headerTickState([], sel)).toBe("none");
  });
});

describe("CP-9 manifest view", () => {
  const big = [b({ profession: "operations", count: 60, race: "belter" }), b({ profession: "science", count: 45, rank: 3, buff2Id: "sci.survey" })];
  const notable: NotableCrewMember = {
    id: "notable-0", profession: "science", rarity: "stellar", rank: 8, race: "vael", buff1Id: "sci.rareFind", buff2Id: "excl.missionTurnaround",
    name: "Aluun Suvei", gender: "female", assignedShipId: "ship-1",
  };
  const elsewhere: NotableCrewMember = { ...notable, id: "notable-1", name: "Away", assignedShipId: "ship-2" };
  const s = withShip(big, [notable, elsewhere]);

  it("pages 50 rows with group headers; names match the engine's manifest", () => {
    const v = manifestView(s, "ship-1", 0, null);
    expect(v).toMatchObject({ page: 0, pageCount: 3, total: 105, from: 1, to: 50, notableTotal: 1 });
    expect(v.notables.map((n) => n.name)).toEqual(["Aluun Suvei"]);
    const rowLines = v.lines.filter((l) => l.kind === "row");
    expect(rowLines).toHaveLength(MANIFEST_PAGE_SIZE);
    expect(v.lines[0]).toMatchObject({ kind: "group", title: "Belter operations group", count: 60 });
    const engine = manifestRows(s, "ship-1", 0, 50).rows.map((r) => r.name);
    expect(rowLines.map((l) => (l.kind === "row" ? l.name : ""))).toEqual(engine);
    const p2 = manifestView(s, "ship-1", 1, null);
    expect(p2.notables).toEqual([]);
    expect(p2.lines.filter((l) => l.kind === "group").map((l) => (l.kind === "group" ? l.title : ""))).toEqual(["Belter operations group", "Spacer science group"]);
    expect(p2).toMatchObject({ from: 51, to: 100 });
  });

  it("the division filter narrows rows and notables; the page clamps", () => {
    const v = manifestView(s, "ship-1", 9, "science");
    expect(v).toMatchObject({ page: 0, pageCount: 1, total: 45, from: 1, to: 45, notableTotal: 1 });
    const none = manifestView(s, "ship-1", 0, "medical");
    expect(none).toMatchObject({ total: 0, from: 0, to: 0, pageCount: 1, notableTotal: 0, lines: [] });
  });

  it("is read-only: the state is untouched", () => {
    const json = JSON.stringify(s);
    manifestView(s, "ship-1", 2, null);
    expect(JSON.stringify(s)).toBe(json);
  });

  it("pager items keep the ends and the neighbors, with gaps", () => {
    expect(pagerItems(0, 3)).toEqual([0, 1, 2]);
    expect(pagerItems(0, 16)).toEqual([0, 1, 2, 3, "gap", 15]);
    expect(pagerItems(8, 16)).toEqual([0, "gap", 7, 8, 9, "gap", 15]);
    expect(pagerItems(15, 16)).toEqual([0, "gap", 12, 13, 14, 15]);
  });
});
