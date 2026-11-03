// E5-1 (Refugee Posts, plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-1): the refugee record, posts per
// level, the readers, and the load-time hydration (nobody is ever lost).

import { describe, expect, it } from "vitest";
import { freshState, type GameState } from "./model";
import {
  REFUGEE_BACKGROUNDS,
  REFUGEE_BACKGROUND_KEYS,
  REFUGEE_FACILITY_KEYS,
  dismissRefugeeHint,
  greetRefugee,
  hydrateRefugees,
  postRefugee,
  unpostRefugee,
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
  it("the user's two E5-0 calls: the Refiner gives extra output, the Stargazer discovery odds (2026-11-03, in place of rare aspect spotting)", () => {
    expect(REFUGEE_BACKGROUNDS.refiner).toEqual({ label: "Refiner", facility: "refinery", statLabel: "extra output chance" });
    expect(REFUGEE_BACKGROUNDS.stargazer).toEqual({ label: "Stargazer", facility: "subspaceTelescope", statLabel: "discovery odds" });
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

// ===== E5-4: the posting actions =====

describe("E5-4 postRefugee / unpostRefugee (free, any time; posted people stay; a full facility swaps)", () => {
  // Refinery Level 4 (two posts), research Level 1 (one post), shipyard unbuilt (level 0).
  function home(list: RefugeeRecord[]): GameState {
    return withRefugees(withLevel(withLevel(withLevel(freshState(), "refinery", 4), "research", 1), "shipyard", 0), list);
  }
  const ids = (s: GameState, f: RefugeeFacilityKey | null) => refugeesOf(s).list.filter((r) => r.posting === f).map((r) => r.id);
  // Everything but the refugee record: an action never costs, times or touches anything else.
  const rest = (s: GameState) => JSON.stringify({ ...s, refugees: undefined });

  it("posts into an open post; the newcomer goes after everyone already posted there", () => {
    const s = home([person(1, "refinery"), person(2), person(3)]);
    const r = postRefugee(s, 3, "refinery");
    expect(r.success).toBe(true);
    expect(r.swappedOutId).toBeUndefined();
    expect(ids(r.next, "refinery")).toEqual([1, 3]);
    expect(ids(r.next, null)).toEqual([2]);
    expect(rest(r.next)).toBe(rest(s));
  });

  it("a full facility swaps: the lowest share goes back to waiting (the last posted among equals), the newcomer takes the post", () => {
    const s = home([person(1, "refinery", { skill: 30 }), person(2, "refinery", { skill: 60 }), person(3, null, { skill: 50 })]);
    const r = postRefugee(s, 3, "refinery");
    expect(r).toMatchObject({ success: true, swappedOutId: 1 });
    expect(ids(r.next, "refinery")).toEqual([2, 3]);
    expect(ids(r.next, null)).toEqual([1]);
    // Equal shares: the last posted returns.
    const tie = home([person(1, "refinery"), person(2, "refinery"), person(3)]);
    expect(postRefugee(tie, 3, "refinery").swappedOutId).toBe(2);
    // The share counts the match: an off-match person (a quarter) is swapped before a matched one of lower skill.
    const off = home([person(1, "refinery", { skill: 30 }), person(2, "refinery", { background: "scholar", skill: 80 }), person(3)]);
    expect(postRefugee(off, 3, "refinery").swappedOutId).toBe(2);
  });

  it("posting where they already are returns the same state; an unbuilt facility, an unknown person or key fails", () => {
    const s = home([person(1, "refinery"), person(2)]);
    expect(postRefugee(s, 1, "refinery")).toEqual({ next: s, success: true });
    expect(postRefugee(s, 1, "refinery").next).toBe(s);
    expect(postRefugee(s, 2, "shipyard")).toEqual({ next: s, success: false });
    expect(postRefugee(s, 99, "refinery")).toEqual({ next: s, success: false });
    expect(postRefugee(s, 2, "warehouseT1" as RefugeeFacilityKey)).toEqual({ next: s, success: false });
    expect(postRefugee(freshState(), 1, "refinery").success).toBe(false);
  });

  it("moving a posted person empties their old post (Review Focus 5); a move into a full facility swaps the other to waiting", () => {
    const s = home([person(1, "refinery"), person(2, "research")]);
    const moved = postRefugee(s, 1, "research");
    expect(moved).toMatchObject({ success: true, swappedOutId: 2 });
    expect(ids(moved.next, "refinery")).toEqual([]);
    expect(ids(moved.next, "research")).toEqual([1]);
    expect(ids(moved.next, null)).toEqual([2]);
  });

  it("unpostRefugee returns them to waiting in arrival order and never removes a record; a waiting person is a no-op", () => {
    const s = home([person(2), person(1, "refinery"), person(3), person(4, "research")]);
    const r = unpostRefugee(s, 1);
    expect(r.success).toBe(true);
    expect(refugeeWaiting(r.next).map((x) => x.id)).toEqual([1, 2, 3]);
    const again = unpostRefugee(unpostRefugee(r.next, 4).next, 4);
    expect(again.success).toBe(true);
    expect(refugeeWaiting(again.next).map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(refugeesOf(again.next).list).toHaveLength(4);
    expect(unpostRefugee(s, 3)).toEqual({ next: s, success: true });
    expect(unpostRefugee(s, 99)).toEqual({ next: s, success: false });
    expect(rest(again.next)).toBe(rest(s));
  });

  it("the posting order survives a save's load: a posted person and a re-post keep their places", () => {
    const s = home([person(1, "refinery"), person(2), person(3)]);
    const posted = postRefugee(postRefugee(s, 2, "refinery").next, 3, "refinery");
    expect(posted.swappedOutId).toBe(2); // equal shares: the last posted returns
    expect(hydrateRefugees(posted.next)).toBe(posted.next);
  });

  it("the swap takes a target: the player may replace the STRONGER person; the lowest share is only the fallback", () => {
    const s = home([person(1, "refinery", { skill: 30 }), person(2, "refinery", { skill: 60 }), person(3, null, { skill: 50 })]);
    const r = postRefugee(s, 3, "refinery", 2);
    expect(r).toMatchObject({ success: true, swappedOutId: 2 });
    expect(r.returnedIds).toBeUndefined();
    expect(ids(r.next, "refinery")).toEqual([1, 3]);
    expect(ids(r.next, null)).toEqual([2]);
    expect(rest(r.next)).toBe(rest(s));
    // No target: the fallback (the lowest share) as before.
    expect(postRefugee(s, 3, "refinery").swappedOutId).toBe(1);
    // A move from another facility can name its target too.
    const move = home([person(1, "refinery", { skill: 30 }), person(2, "refinery", { skill: 60 }), person(3, "research")]);
    const moved = postRefugee(move, 3, "refinery", 2);
    expect(moved).toMatchObject({ success: true, swappedOutId: 2 });
    expect(ids(moved.next, "research")).toEqual([]);
    // With a free post nobody is swapped out (the target is not needed).
    const open = home([person(1, "refinery"), person(2)]);
    const free = postRefugee(open, 2, "refinery", 1);
    expect(free.swappedOutId).toBeUndefined();
    expect(ids(free.next, "refinery")).toEqual([1, 2]);
  });

  it("an invalid target is refused (the same state): not posted here, waiting, unknown, or the newcomer", () => {
    const s = home([person(1, "refinery"), person(2, "refinery"), person(3), person(4, "research")]);
    for (const target of [3, 4, 99, 5]) expect(postRefugee(s, 3, "refinery", target)).toEqual({ next: s, success: false });
    expect(postRefugee(s, 3, "refinery", 3)).toEqual({ next: s, success: false });
    expect(postRefugee(s, 4, "refinery", 4)).toEqual({ next: s, success: false });
  });

  it("posting into a facility over its post count (a save not yet trimmed) leaves it AT its posts; nobody is removed", () => {
    // Research Level 1: one post, three posted (as a save that skipped the load trim would hold).
    const over = home([person(1, "research", { skill: 70 }), person(2, "research", { skill: 20 }), person(3, "research", { skill: 50 }), person(4)]);
    const r = postRefugee(over, 4, "research");
    expect(r.success).toBe(true);
    expect(ids(r.next, "research")).toEqual([4]);
    expect(r.swappedOutId).toBe(2); // the fallback: the lowest share
    expect(r.returnedIds).toEqual([3, 1]); // the overflow: the last posted first
    expect(ids(r.next, null)).toEqual([1, 2, 3]); // back in arrival order
    expect(refugeesOf(r.next).list).toHaveLength(4);
    // With a target: that person goes, the overflow goes too, and the facility ends at its posts.
    const t = postRefugee(over, 4, "research", 1);
    expect(t).toMatchObject({ success: true, swappedOutId: 1, returnedIds: [3, 2] });
    expect(ids(t.next, "research")).toEqual([4]);
    expect(refugeesOf(t.next).list).toHaveLength(4);
    // A facility AT its posts swaps exactly one (no overflow to return).
    const full = home([person(1, "research"), person(2)]);
    expect(postRefugee(full, 2, "research").returnedIds).toBeUndefined();
  });

  it("hydration keeps the carried fractions in (0, 1) for the three known keys and drops anything else", () => {
    const clean = withRefugees(freshState(), [person(1)], { carry: { research: 0.25, fabricator: 0.5 } });
    expect(hydrateRefugees(clean)).toBe(clean);
    const junk = withRefugees(freshState(), [person(1)], { carry: { research: 1, relicStudy: 0.75, fabricator: -0.1, other: 0.5 } as never });
    expect(refugeesOf(hydrateRefugees(junk)).carry).toEqual({ relicStudy: 0.75 });
    const allBad = withRefugees(freshState(), [person(1)], { carry: { research: Number.NaN } as never });
    expect("carry" in refugeesOf(hydrateRefugees(allBad))).toBe(false);
    const notObject = withRefugees(freshState(), [person(1)], { carry: 3 as never });
    expect("carry" in refugeesOf(hydrateRefugees(notObject))).toBe(false);
  });

  it("greetRefugee removes the id from greet; dismissRefugeeHint sets hintSeen once; both return the same state on a no-op", () => {
    const s = withRefugees(freshState(), [person(1), person(2)], { greet: [1, 2] });
    const g = greetRefugee(s, 1);
    expect(refugeesOf(g).greet).toEqual([2]);
    expect(greetRefugee(g, 1)).toBe(g);
    const h = dismissRefugeeHint(g);
    expect(refugeesOf(h).hintSeen).toBe(true);
    expect(dismissRefugeeHint(h)).toBe(h);
    const fresh = freshState();
    expect(dismissRefugeeHint(fresh)).toBe(fresh);
    expect(greetRefugee(fresh, 1)).toBe(fresh);
  });
});
