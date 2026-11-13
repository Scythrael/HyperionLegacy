// The Personnel notable band's display logic (notableTickerDisplay.ts; signed mockup
// docs/mockups/2026-11-12-personnel-notable-ticker-mockup.html, option A): the order (favorites first, then graduation
// order), the unassigned label, the empty hint, the count, the All list's groups and the record card.
import { describe, it, expect } from "vitest";
import { NOTABLE_CREW_CAP, freshState, shipDisplayLabels } from "./game/model";
import type { CrewBucket, GameState, NotableCrewMember } from "./game/model";
import { emptyGroundTeams } from "./game/groundTeams";
import { graduateStandout, retireNotable, sendBackNotable } from "./game/crewGraduation";
import { signatureKey } from "./game/crew";
import {
  NOTABLE_TICKER_EMPTY_HINT,
  UNASSIGNED_LABEL,
  notableAllGroups,
  notableIdNumber,
  notableRecordView,
  notableTickerCount,
  notableTickerEntries,
  orderNotables,
} from "./notableTickerDisplay";

const HULL = "generalFreighter" as const;

function notable(num: number, over: Partial<NotableCrewMember> = {}): NotableCrewMember {
  return {
    id: `notable-${num}`,
    profession: "science",
    rarity: "standard",
    rank: 7,
    race: "vael",
    buff1Id: "sci.rareFind",
    buff2Id: null,
    name: `Crew ${num}`,
    gender: "f",
    assignedShipId: "ship-1",
    ...over,
  };
}

// ship-1 (freshState's freighter) and ship-2 (a parked freighter), with the given notables.
function fleet(notables: NotableCrewMember[]): GameState {
  const base = freshState();
  return {
    ...base,
    notableCrew: notables,
    ships: [
      { ...base.ships[0], complement: { buckets: [], mode: "active" } },
      { id: "ship-2", typeKey: HULL, assignedCaptainId: null, complement: { buckets: [] as CrewBucket[], mode: "active" as const }, groundTeams: emptyGroundTeams(HULL) },
    ] as GameState["ships"],
  };
}

describe("notable band order", () => {
  it("favorites first, then the rest, each part oldest graduate first, whatever the stored order", () => {
    const list = [notable(5), notable(2, { favorite: true }), notable(10), notable(1), notable(7, { favorite: true })];
    expect(orderNotables(list).map((n) => n.id)).toEqual(["notable-2", "notable-7", "notable-1", "notable-5", "notable-10"]);
  });

  it("orders by the id's number, not its text (notable-10 after notable-9)", () => {
    expect(orderNotables([notable(10), notable(9)]).map((n) => n.id)).toEqual(["notable-9", "notable-10"]);
  });

  it("an id without a number sorts after the numbered ones, and a full tie keeps the stored order", () => {
    const odd = { ...notable(0), id: "legacy" };
    expect(orderNotables([odd, notable(3)]).map((n) => n.id)).toEqual(["notable-3", "legacy"]);
    const twinA = { ...notable(4), name: "A" };
    const twinB = { ...notable(4), name: "B" };
    expect(orderNotables([twinB, twinA]).map((n) => n.name)).toEqual(["B", "A"]);
    expect(notableIdNumber("notable-42")).toBe(42);
    expect(notableIdNumber("legacy")).toBeNull();
  });

  it("unassigned notables sit in place among the others", () => {
    const s = fleet([notable(1), notable(2, { assignedShipId: null }), notable(3, { assignedShipId: "ship-2" })]);
    expect(notableTickerEntries(s).map((e) => e.id)).toEqual(["notable-1", "notable-2", "notable-3"]);
  });

  it("does not mutate the stored list", () => {
    const list = [notable(2), notable(1)];
    orderNotables(list);
    expect(list.map((n) => n.id)).toEqual(["notable-2", "notable-1"]);
  });
});

describe("notable band entries", () => {
  it("name, rank, division and the ship's display label", () => {
    const s = fleet([notable(1, { rank: 8, profession: "medical", favorite: true }), notable(2, { assignedShipId: "ship-2" })]);
    const labels = shipDisplayLabels(s.ships);
    const [a, b] = notableTickerEntries(s);
    expect(a).toMatchObject({ name: "Crew 1", rankLabel: "Lieutenant Commander", divisionLabel: "Medical", originLabel: "Vael", shipId: "ship-1", shipLabel: labels.get("ship-1"), favorite: true });
    expect(a.ariaLabel).toBe(`Crew 1, Lieutenant Commander, Medical, aboard ${labels.get("ship-1")}, favorite. Open the record.`);
    expect(b).toMatchObject({ shipId: "ship-2", shipLabel: labels.get("ship-2"), favorite: false });
  });

  it("an unassigned notable reads Unassigned (a null, an absent field, or a ship no longer in the fleet)", () => {
    const s = fleet([notable(1, { assignedShipId: null }), notable(2, { assignedShipId: undefined }), notable(3, { assignedShipId: "ship-gone" })]);
    for (const e of notableTickerEntries(s)) {
      expect(e.shipId).toBeNull();
      expect(e.shipLabel).toBe(UNASSIGNED_LABEL);
      expect(e.ariaLabel).toContain(", Unassigned.");
    }
    expect(UNASSIGNED_LABEL).toBe("Unassigned");
  });

  it("Send back leaves the notable in the band as Unassigned; Retire removes it", () => {
    const s = fleet([notable(1), notable(2)]);
    const back = sendBackNotable(s, "notable-1");
    expect(notableTickerEntries(back).find((e) => e.id === "notable-1")?.shipLabel).toBe(UNASSIGNED_LABEL);
    const gone = retireNotable(back, "notable-1");
    expect(notableTickerEntries(gone).map((e) => e.id)).toEqual(["notable-2"]);
  });
});

describe("notable band empty state and count", () => {
  it("no notables: no entries, a zero count and the hint", () => {
    const s = fleet([]);
    expect(notableTickerEntries(s)).toEqual([]);
    expect(notableTickerCount(s)).toMatchObject({ count: 0, text: `0 / ${NOTABLE_CREW_CAP}`, atCap: false });
    expect(NOTABLE_TICKER_EMPTY_HINT).toBe("No notable crew yet. On a ship's Complement tab, use Graduate one on a crew group to name a standout.");
  });

  it("the hint is true: Graduate one on a ship's crew group is how a notable is made", () => {
    const base = fleet([]);
    const b: CrewBucket = { profession: "science", rarity: "standard", rank: 3, race: "vael", buff1Id: "sci.rareFind", buff2Id: null, count: 2 };
    const s = { ...base, ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, complement: { buckets: [b], mode: "active" as const } } : sh)) };
    const { next, notable: made } = graduateStandout(s, "ship-1", signatureKey(b));
    expect(made).not.toBeNull();
    expect(notableTickerEntries(next).map((e) => e.id)).toEqual([made!.id]);
  });

  it("at the cap the count is flagged", () => {
    const s = fleet(Array.from({ length: NOTABLE_CREW_CAP }, (_, i) => notable(i + 1)));
    expect(notableTickerCount(s)).toMatchObject({ count: NOTABLE_CREW_CAP, atCap: true, text: `${NOTABLE_CREW_CAP} / ${NOTABLE_CREW_CAP}` });
  });
});

describe("the All list", () => {
  it("groups by ship, ships A to Z, Unassigned last; inside a group the band's order", () => {
    const s = fleet([
      notable(1, { assignedShipId: null }),
      notable(2, { assignedShipId: "ship-2" }),
      notable(3),
      notable(4, { assignedShipId: "ship-2", favorite: true }),
    ]);
    const labels = shipDisplayLabels(s.ships);
    const groups = notableAllGroups(notableTickerEntries(s));
    const shipOrder = ["ship-1", "ship-2"].sort((x, y) => labels.get(x)!.localeCompare(labels.get(y)!, "en") || (x < y ? -1 : 1));
    expect(groups.map((g) => g.key)).toEqual([...shipOrder, ""]);
    expect(groups[groups.length - 1].label).toBe(UNASSIGNED_LABEL);
    expect(groups.find((g) => g.key === "ship-2")!.entries.map((e) => e.id)).toEqual(["notable-4", "notable-2"]);
  });

  it("no Unassigned group when everyone is aboard, and none at all when empty", () => {
    expect(notableAllGroups(notableTickerEntries(fleet([notable(1)]))).map((g) => g.key)).toEqual(["ship-1"]);
    expect(notableAllGroups([])).toEqual([]);
  });
});

describe("the record card", () => {
  it("origin and every buff, with the ship", () => {
    const s = fleet([notable(1, { buff2Id: "excl.missionTurnaround", favorite: true })]);
    const r = notableRecordView(s, "notable-1")!;
    expect(r.subLine).toBe("Lieutenant · Science · Vael");
    expect(r.buffs.map((b) => b.id)).toEqual(["sci.rareFind", "excl.missionTurnaround"]);
    expect(r).toMatchObject({ name: "Crew 1", favorite: true, shipId: "ship-1", shipLabel: shipDisplayLabels(s.ships).get("ship-1") });
  });

  it("unassigned reads Unassigned; a retired notable has no record", () => {
    const s = fleet([notable(1, { assignedShipId: null })]);
    expect(notableRecordView(s, "notable-1")).toMatchObject({ shipId: null, shipLabel: UNASSIGNED_LABEL });
    expect(notableRecordView(s, "notable-9")).toBeNull();
  });
});
