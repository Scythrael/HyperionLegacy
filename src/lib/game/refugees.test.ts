// E5-1 (Refugee Posts, plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-1): the refugee record, posts per
// level, the readers, and the load-time hydration (nobody is ever lost).

import { describe, expect, it } from "vitest";
import { freshState, type GameState } from "./model";
import {
  REFUGEE_BACKGROUNDS,
  REFUGEE_BACKGROUND_KEYS,
  REFUGEE_FACILITY_KEYS,
  hydrateRefugees,
  isWellFormedRefugeeRecord,
  refugeeOpenPosts,
  refugeePostCount,
  refugeePostsAt,
  refugeesOf,
  refugeesPostedAt,
  refugeeWaiting,
  type RefugeeFacilityKey,
  type RefugeeRecord,
  type RefugeeState,
} from "./refugees";

function person(id: number, posting: RefugeeFacilityKey | null = null, over: Partial<RefugeeRecord> = {}): RefugeeRecord {
  return {
    id,
    name: `Person ${id}`,
    background: "refiner",
    skill: 42,
    origin: { tier: 1, destinationIndex: 0 },
    portrait: { hair: 1, palette: 3 },
    arrivedAtSeconds: 100 * id,
    posting,
    ...over,
  };
}

function withRefugees(state: GameState, list: unknown[], extra: Partial<RefugeeState> = {}): GameState {
  return { ...state, refugees: { version: 1, list: list as RefugeeRecord[], nextId: list.length + 1, arrivedTotal: list.length, greet: [], ...extra } };
}

function withLevel(state: GameState, facility: string, level: number): GameState {
  return { ...state, facilities: { ...state.facilities, [facility]: { ...state.facilities[facility], level } } };
}

describe("E5-1 backgrounds", () => {
  it("eight backgrounds, one per refugee facility, each matching a distinct facility", () => {
    expect(REFUGEE_BACKGROUND_KEYS).toHaveLength(8);
    expect(new Set(REFUGEE_BACKGROUND_KEYS.map((b) => REFUGEE_BACKGROUNDS[b].facility))).toEqual(new Set(REFUGEE_FACILITY_KEYS));
    expect(Object.keys(REFUGEE_BACKGROUNDS).sort()).toEqual([...REFUGEE_BACKGROUND_KEYS].sort());
  });
  it("the user's two E5-0 calls: the Refiner gives extra output, the Stargazer rare aspect spotting", () => {
    expect(REFUGEE_BACKGROUNDS.refiner).toEqual({ label: "Refiner", facility: "refinery", statLabel: "extra output chance" });
    expect(REFUGEE_BACKGROUNDS.stargazer).toEqual({ label: "Stargazer", facility: "subspaceTelescope", statLabel: "rare aspect spotting" });
  });
  it("labels avoid em dashes, double hyphens and the word fit", () => {
    for (const b of REFUGEE_BACKGROUND_KEYS) {
      const text = `${REFUGEE_BACKGROUNDS[b].label} ${REFUGEE_BACKGROUNDS[b].statLabel}`;
      expect(text).not.toMatch(/—|--|\bfit/i);
    }
  });
});

describe("E5-1 posts per level", () => {
  it("opens at Levels 1, 4, 7, 10", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 10].map(refugeePostsAt)).toEqual([0, 1, 1, 1, 2, 2, 3, 4]);
  });
  it("a non-finite or negative level opens none", () => {
    expect([NaN, Infinity, -1].map(refugeePostsAt)).toEqual([0, 0, 0]);
  });
});

describe("E5-1 readers", () => {
  it("a save without the field reads as nobody yet, and a fresh state has no refugees key", () => {
    const fresh = freshState();
    expect("refugees" in fresh).toBe(false);
    expect(refugeesOf(fresh)).toEqual({ version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [] });
    expect(refugeeWaiting(fresh)).toEqual([]);
    expect(refugeesPostedAt(fresh, "research")).toEqual([]);
  });
  it("open posts on a fresh state are the four Level 1 facilities' posts", () => {
    const fresh = freshState();
    expect(refugeeOpenPosts(fresh)).toBe(4);
    expect(refugeePostCount(fresh, "refinery")).toBe(0);
    expect(refugeePostCount(fresh, "research")).toBe(1);
  });
  it("posted and waiting split the list; open posts never go below 0", () => {
    const s = withRefugees(freshState(), [person(1, "research"), person(2), person(3, "research"), person(4, "fabricator")]);
    expect(refugeeWaiting(s).map((r) => r.id)).toEqual([2]);
    expect(refugeesPostedAt(s, "research").map((r) => r.id)).toEqual([1, 3]);
    // research holds 2 at 1 post (counts 0 open, not -1); fabricator full; missionControl and the telescope open.
    expect(refugeeOpenPosts(s)).toBe(2);
  });
});

describe("E5-1 record shape check", () => {
  it("accepts a whole record and rejects a broken one", () => {
    expect(isWellFormedRefugeeRecord(person(1))).toBe(true);
    expect(isWellFormedRefugeeRecord(person(1, "shipyard"))).toBe(true);
    expect(isWellFormedRefugeeRecord({ ...person(1), background: "miner" })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), skill: NaN })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), skill: Infinity })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), id: 0 })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), name: "" })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), origin: { tier: 3, destinationIndex: 0 } })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), portrait: { hair: 4, palette: 0 } })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), portrait: { hair: 0, palette: 8 } })).toBe(false);
    expect(isWellFormedRefugeeRecord({ ...person(1), posting: "warehouseT1" })).toBe(false);
    expect(isWellFormedRefugeeRecord(null)).toBe(false);
  });
});

describe("E5-1 hydrateRefugees", () => {
  it("a state without the field, or a clean one, is returned as is", () => {
    const fresh = freshState();
    expect(hydrateRefugees(fresh)).toBe(fresh);
    const clean = withRefugees(freshState(), [person(1, "research"), person(2)], { greet: [2], hintSeen: true });
    expect(hydrateRefugees(clean)).toBe(clean);
  });
  it("drops only an unreadable record, keeping the rest in order", () => {
    const s = withRefugees(freshState(), [person(1), { ...person(2), background: "miner" }, person(3), { ...person(4), skill: NaN }, person(5)]);
    const h = hydrateRefugees(s);
    expect(refugeesOf(h).list.map((r) => r.id)).toEqual([1, 3, 5]);
  });
  it("Review Focus 1: a Level 1 refinery holding two keeps the earlier posted, the other returns to waiting", () => {
    const s = withLevel(withRefugees(freshState(), [person(1, "refinery"), person(2, "refinery")]), "refinery", 1);
    const h = hydrateRefugees(s);
    expect(refugeesPostedAt(h, "refinery").map((r) => r.id)).toEqual([1]);
    expect(refugeeWaiting(h).map((r) => r.id)).toEqual([2]);
    expect(refugeesOf(h).list).toHaveLength(2); // nobody dropped
  });
  it("an unbuilt facility holds nobody: everyone posted there returns to waiting", () => {
    const s = withRefugees(freshState(), [person(1, "shipyard"), person(2, "shipyard")]);
    const h = hydrateRefugees(s);
    expect(refugeeWaiting(h).map((r) => r.id)).toEqual([1, 2]);
  });
  it("a posting to a non-refugee facility key returns that person to waiting", () => {
    const s = withRefugees(freshState(), [{ ...person(1), posting: "warehouseT1" }, person(2, "research")]);
    const h = hydrateRefugees(s);
    expect(refugeesOf(h).list.map((r) => [r.id, r.posting])).toEqual([[1, null], [2, "research"]]);
  });
  it("repairs the counters: nextId past every id, arrivedTotal at least the list, greet only ids at home", () => {
    const s = withRefugees(freshState(), [person(3), person(7)], { nextId: 2, arrivedTotal: 1, greet: [7, 9, 7, -1] });
    const r = refugeesOf(hydrateRefugees(s));
    expect(r.nextId).toBe(8);
    expect(r.arrivedTotal).toBe(2);
    expect(r.greet).toEqual([7]);
  });
  it("a repeated id keeps the first record only", () => {
    const s = withRefugees(freshState(), [person(1), person(1, "research"), person(2)]);
    expect(refugeesOf(hydrateRefugees(s)).list.map((r) => [r.id, r.posting])).toEqual([[1, null], [2, null]]);
  });
  it("a whole value that is not a version 1 object is dropped (reads as nobody yet)", () => {
    for (const bad of [null, 5, [], { version: 2, list: [] }]) {
      const h = hydrateRefugees({ ...freshState(), refugees: bad as unknown as RefugeeState });
      expect("refugees" in h).toBe(false);
    }
  });
});
