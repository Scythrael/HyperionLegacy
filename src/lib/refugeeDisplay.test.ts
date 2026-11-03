// E5-5 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-5): the Posts strip and the post picker views.
// Every number is checked against the engine (refugeeShare, refugeeFacilityBonus, refugeeBonusIfPosted, postRefugee).

import { describe, expect, it } from "vitest";
import { freshState, type CompletionLogEntry, type GameState } from "./game/model";
import { dismissRefugeeHint, greetRefugee, postRefugee, unpostRefugee, refugeeShare, type RefugeeBackground, type RefugeeFacilityKey, type RefugeeRecord } from "./game/refugees";
import { refugeeBonusIfPosted, refugeeFacilityBonus } from "./game/refugeeBuffs";
import { buildHomeDashboard } from "./game/homeDashboard";
import {
  arrivalCardIds,
  arrivalCardView,
  firstArrivalHintView,
  refugeeBestOpenPost,
  refugeesTabView,
  refugeesTabVisible,
  slowArrivalsLine,
  percentText,
  personPostView,
  postPickerView,
  postsStripShown,
  postsStripView,
  refugeeBestPost,
} from "./refugeeDisplay";

function person(id: number, name: string, background: RefugeeBackground, skill: number, posting: RefugeeFacilityKey | null): RefugeeRecord {
  return { id, name, background, skill, origin: { tier: 1, destinationIndex: 0 }, portrait: { hair: (id % 4) as 0 | 1 | 2 | 3, palette: id % 8 }, arrivedAtSeconds: 0, posting };
}

function withLevels(s: GameState, levels: Partial<Record<RefugeeFacilityKey, number>>): GameState {
  const facilities = { ...s.facilities };
  for (const [k, level] of Object.entries(levels)) facilities[k] = { ...(facilities[k] ?? {}), level: level as number };
  return { ...s, facilities };
}

function withPeople(s: GameState, list: RefugeeRecord[]): GameState {
  return { ...s, refugees: { version: 1, list, nextId: list.length + 1, arrivedTotal: list.length, greet: [] } };
}

// The mockup's homeworld: a Research Lab at Level 4 (2 posts) holding a Scholar and an off-match Machinist, a
// Refinery at Level 4 (2 posts) holding one Refiner, a Fabricator at Level 1 (1 open post), a waiting list of four.
function refugeesWithout(s: GameState, id: number): RefugeeRecord[] {
  return (s.refugees?.list ?? []).map((r) => (r.id === id ? { ...r, posting: null } : r));
}

function mockupState(): GameState {
  const s = withLevels(freshState(1), { refinery: 4, research: 4, fabricator: 1, fuelStorage: 1, subspaceTelescope: 1, salvageBay: 1 });
  return withPeople(s, [
    person(1, "Mira Talven", "refiner", 42, "refinery"),
    person(2, "Kesia Lunde", "scholar", 58, "research"),
    person(3, "Dov Hasker", "machinist", 37, "research"),
    person(4, "Tamsin Corr", "refiner", 61, null),
    person(5, "Ansel Rook", "refiner", 27, null),
    person(6, "Juno Pirelle", "stargazer", 68, null),
    person(7, "Neve Ardent", "salvager", 44, null),
  ]);
}

describe("percentText", () => {
  it("reads a fraction as a signed percent with one decimal", () => {
    expect(percentText(0.042)).toBe("+4.2%");
    expect(percentText(0.0105)).toBe("+1.1%");
    expect(percentText(-0.012)).toBe("-1.2%");
    expect(percentText(0)).toBe("+0.0%");
  });
  it("keeps a small real buff visible", () => {
    expect(percentText(0.0004)).toBe("+0.04%");
  });
});

describe("postsStripView", () => {
  it("is null on a fresh save and for a level-0 facility", () => {
    const fresh = freshState(1);
    expect(postsStripView(fresh, "research")).toBeNull();
    expect(postsStripShown(fresh, "research")).toBe(false);
    const s = withLevels(mockupState(), { shipyard: 0 });
    expect(postsStripView(s, "shipyard")).toBeNull();
    expect(postsStripView(s, "research")).not.toBeNull();
  });

  it("stays once anyone has arrived, even with nobody left", () => {
    const s = { ...withLevels(freshState(1), { research: 1 }), refugees: { version: 1 as const, list: [], nextId: 3, arrivedTotal: 2, greet: [] } };
    const v = postsStripView(s, "research")!;
    expect(v.countText).toBe("0 / 1");
    expect(v.emptyText).toBe("nobody waiting");
    expect(v.note).toBe("Empty posts give nothing; anyone posted here helps a little.");
  });

  it("reads the posts, the next post and each filled post", () => {
    const s = mockupState();
    const v = postsStripView(s, "research")!;
    expect(v.countText).toBe("2 / 2");
    expect(v.full).toBe(true);
    expect(v.emptyPosts).toBe(0);
    expect(v.nextPostText).toBe("3rd post at Level 7");
    expect(v.nextPostShort).toBe("3rd at Level 7");
    expect(v.slots.map((x) => [x.name, x.backgroundLabel, x.matchText, x.shareText])).toEqual([
      ["Kesia Lunde", "Scholar", "match", percentText(refugeeShare({ background: "scholar", skill: 58 }, "research"))],
      ["Dov Hasker", "Machinist", "other", percentText(refugeeShare({ background: "machinist", skill: 37 }, "research"))],
    ]);
    expect(v.slots[0].shareText).toBe("+5.8%");
    expect(v.slots[1].shareText).toBe("+0.9%");
  });

  it("says nothing about a next post past the facility's top level", () => {
    // The Refinery tops out at Level 4 (two posts), so no "3rd post" line is promised.
    expect(postsStripView(mockupState(), "refinery")!.nextPostText).toBeNull();
  });

  it("reads the curved total (stacked on the diminishing curve) and the shares line", () => {
    const s = withPeople(withLevels(freshState(1), { research: 4 }), [
      person(1, "Kesia Lunde", "scholar", 58, "research"),
      person(2, "Abel Moss", "scholar", 30, "research"),
    ]);
    const v = postsStripView(s, "research")!;
    expect(v.total).toBe(refugeeFacilityBonus(s, "research"));
    expect(v.totalText).toBe(`${percentText(refugeeFacilityBonus(s, "research"))} research speed`);
    expect(v.total).toBeLessThan(0.058 + 0.03);
    expect(v.sharesLine).toEqual([{ firstName: "Kesia", shareShort: "+5.8" }, { firstName: "Abel", shareShort: "+3.0" }]);
    expect(v.note).toBe("stacked on the diminishing curve");
    expect(v.noteIsHint).toBe(false);
  });

  it("hints at an off-match person only when another facility gives more", () => {
    const s = mockupState();
    const v = postsStripView(s, "research")!;
    const fab = refugeeBonusIfPosted(s, 3, "fabricator").gain;
    expect(v.noteIsHint).toBe(true);
    expect(v.note).toBe(`Dov would give ${percentText(fab)} craft speed at the Fabricator`);
    expect(v.note).toBe("Dov would give +3.6% craft speed at the Fabricator");
    // With the Fabricator unbuilt there is no match to point at (another off-match post is no reason to move).
    const noFab = withLevels(s, { fabricator: 0 });
    const w = postsStripView(noFab, "research")!;
    expect(w.noteIsHint).toBe(false);
    expect(w.note).toBe("stacked on the diminishing curve");
  });

  it("counts the waiting and the matching backgrounds on an empty post", () => {
    const s = mockupState();
    expect(postsStripView(s, "fabricator")!.emptyText).toBe("4 waiting · no machinists yet");
    const refinery = postsStripView(s, "refinery")!;
    expect(refinery.emptyPosts).toBe(1);
    expect(refinery.emptyText).toBe("4 waiting · 2 refiners");
    const one = withPeople(withLevels(freshState(1), { refinery: 1 }), [person(1, "Ansel Rook", "refiner", 27, null)]);
    expect(postsStripView(one, "refinery")!.emptyText).toBe("1 waiting · a refiner");
  });
});

describe("postPickerView", () => {
  it("sorts the waiting by the gain here and shows what the total becomes", () => {
    const s = mockupState();
    const v = postPickerView(s, "refinery");
    expect(v.full).toBe(false);
    expect(v.title).toBe("Post someone at the Refinery");
    expect(v.meta).toBe("post 2 of 2 · Level 4");
    expect(v.waiting.map((r) => r.name)).toEqual(["Tamsin Corr", "Ansel Rook", "Juno Pirelle", "Neve Ardent"]);
    expect(v.waiting[0].top).toBe(true);
    expect(v.waiting.slice(1).every((r) => !r.top)).toBe(true);
    for (const r of v.waiting) {
      const eng = refugeeBonusIfPosted(s, r.id, "refinery");
      expect(r.gain).toBe(eng.gain);
      if (r.matched) expect(r.detail).toBe(`total becomes ${percentText(eng.total)}`);
    }
    // Sorted by gain, highest first.
    for (let i = 1; i < v.waiting.length; i++) expect(v.waiting[i - 1].gain).toBeGreaterThanOrEqual(v.waiting[i].gain);
  });

  it("shows an off-match person's gain at their own facility", () => {
    const s = mockupState();
    const juno = postPickerView(s, "refinery").waiting.find((r) => r.name === "Juno Pirelle")!;
    const home = refugeeBonusIfPosted(s, 6, "subspaceTelescope").gain;
    expect(juno.matchText).toBe("other");
    expect(juno.detail).toBe(`${percentText(home)} discovery odds at the Subspace Telescope`);
    expect(juno.detailShort).toBe(`${percentText(home)} at Subspace Telescope`);
  });

  it("lists people posted elsewhere under their own heading", () => {
    const s = mockupState();
    const v = postPickerView(s, "refinery");
    expect(v.posted.map((r) => r.name).sort()).toEqual(["Dov Hasker", "Kesia Lunde"]);
    const dov = v.posted.find((r) => r.name === "Dov Hasker")!;
    expect(dov.whereText).toBe("now at Research Lab (+0.9%)");
    expect(dov.gain).toBe(refugeeBonusIfPosted(s, 3, "refinery").gain);
    expect(v.footText).toBe("4 waiting · 2 more posted elsewhere");
  });

  it("compares an off-match person posted elsewhere with what they add where they are", () => {
    const s = mockupState();
    // The mockup's Dov: off match at the Refinery (beside Mira), posted at the Research Lab (beside Kesia): the same.
    const dov = postPickerView(s, "refinery").posted.find((r) => r.name === "Dov Hasker")!;
    const there = refugeeFacilityBonus(s, "research") - refugeeFacilityBonus(withPeople(s, refugeesWithout(s, 3)), "research");
    expect(percentText(dov.gain)).toBe(percentText(there));
    expect(dov.detail).toBe("same as where they are now");
    expect(dov.detailShort).toBe("same as now");
    // Alone at the Research Lab, offered a Refinery that a strong refiner already lifts high on the curve: he would
    // add less there, and the row says what he adds now instead.
    const st = withPeople(withLevels(freshState(1), { refinery: 4, research: 4 }), [
      person(1, "Dov Hasker", "machinist", 37, "research"),
      person(2, "Mira Talven", "refiner", 100, "refinery"),
    ]);
    const d = postPickerView(st, "refinery").posted.find((r) => r.id === 1)!;
    const now = refugeeShare({ background: "machinist", skill: 37 }, "research");
    expect(percentText(d.gain)).not.toBe(percentText(now));
    expect(d.detail).toBe(`vs ${percentText(now)} research speed now`);
    expect(d.detailShort).toBe(`vs ${percentText(now)} now`);
  });

  it("offers a swap on a full facility, defaulting to the engine's pick and following the player's", () => {
    const s = mockupState();
    const v = postPickerView(s, "research");
    expect(v.full).toBe(true);
    expect(v.swap).not.toBeNull();
    expect(v.swap!.targets.map((t) => t.name)).toEqual(["Kesia Lunde", "Dov Hasker"]);
    expect(v.swap!.replaceId).toBe(postRefugee(s, 4, "research").swappedOutId);
    expect(v.swap!.replaceId).toBe(3); // Dov, the lowest share
    for (const r of v.waiting) expect(r.gain).toBe(refugeeBonusIfPosted(s, r.id, "research", 3).gain);
    const pickKesia = postPickerView(s, "research", 2);
    expect(pickKesia.swap!.replaceId).toBe(2);
    for (const r of pickKesia.waiting) expect(r.gain).toBe(refugeeBonusIfPosted(s, r.id, "research", 2).gain);
    // A target not posted here falls back to the engine's pick.
    expect(postPickerView(s, "research", 99).swap!.replaceId).toBe(3);
  });

  it("does not offer a swap with a free post", () => {
    expect(postPickerView(mockupState(), "fabricator").swap).toBeNull();
  });
});

describe("refugeeBestPost and personPostView", () => {
  it("finds the facility a person adds the most at", () => {
    const s = mockupState();
    const best = refugeeBestPost(s, 4)!; // Tamsin, a refiner
    expect(best.facility).toBe("refinery");
    expect(best.open).toBe(true);
    expect(best.gain).toBe(refugeeBonusIfPosted(s, 4, "refinery").gain);
    expect(refugeeBestPost(s, 999)).toBeNull();
    // Dov's best is the Fabricator, never the post he holds.
    expect(refugeeBestPost(s, 3)!.facility).toBe("fabricator");
  });

  it("lists every other facility with posts, sorted by gain, full ones with a swap per person", () => {
    const s = mockupState();
    const v = personPostView(s, 3)!; // Dov, at the Research Lab
    expect(v.title).toBe("Move Dov Hasker");
    expect(v.currentText).toBe("Now at the Research Lab: +0.9% research speed.");
    expect(v.choices.map((c) => c.facility)).not.toContain("research");
    expect(v.choices[0].facility).toBe("fabricator");
    for (let i = 1; i < v.choices.length; i++) expect(v.choices[i - 1].gain).toBeGreaterThanOrEqual(v.choices[i].gain);
    for (const c of v.choices) {
      if (c.open) expect(c.gain).toBe(refugeeBonusIfPosted(s, 3, c.facility).gain);
      else expect(c.gain).toBe(Math.max(...c.swaps.map((w) => w.gain)));
    }
    const tamsin = personPostView(s, 4)!;
    const research = tamsin.choices.find((c) => c.facility === "research")!;
    expect(research.open).toBe(false);
    expect(research.openText).toBe("full · swap");
    expect(research.swaps.map((w) => [w.id, w.gain])).toEqual([
      [2, refugeeBonusIfPosted(s, 4, "research", 2).gain],
      [3, refugeeBonusIfPosted(s, 4, "research", 3).gain],
    ]);
    expect(research.swaps.find((w) => w.isDefault)!.id).toBe(3);
    expect(tamsin.title).toBe("Post Tamsin Corr");
    expect(personPostView(s, 999)).toBeNull();
  });

  it("shows the real result of each Replace: replacing the strongest person gains less, or loses", () => {
    const s = mockupState();
    const research = personPostView(s, 6)!.choices.find((c) => c.facility === "research")!; // Juno, a stargazer
    expect(research.open).toBe(false);
    const kesia = research.swaps.find((w) => w.id === 2)!; // the Scholar, the strongest share here
    const dov = research.swaps.find((w) => w.id === 3)!;
    const realKesia = refugeeBonusIfPosted(s, 6, "research", 2);
    const realDov = refugeeBonusIfPosted(s, 6, "research", 3);
    expect(kesia.gain).toBe(realKesia.gain);
    expect(kesia.gain).toBeLessThan(0);
    expect(kesia.gainText).toBe(`${percentText(realKesia.gain)} research speed`);
    expect(kesia.totalText).toBe(`total becomes ${percentText(realKesia.total)}`);
    expect(dov.gain).toBe(realDov.gain);
    expect(dov.totalText).toBe(`total becomes ${percentText(realDov.total)}`);
    expect(kesia.gain).toBeLessThan(dov.gain);
    // The row itself never claims one swap's number as the result.
    expect(research.gainText).toBe(`up to ${percentText(Math.max(realKesia.gain, realDov.gain))} research speed`);
    expect(research.totalText).toBe("depends on who you replace");
  });

  it("says a Replace sends the replaced person back to waiting, only when a facility is full", () => {
    const s = mockupState();
    expect(personPostView(s, 4)!.summary).toBe(
      "Waiting at home. Moving is free, any time; an old post goes empty. On a full facility, Replace sends the person you replace back to the waiting list.",
    );
    const open = withPeople(withLevels(freshState(1), { refinery: 1 }), [person(1, "Ansel Rook", "refiner", 27, null)]);
    expect(personPostView(open, 1)!.summary).toBe("Waiting at home. Moving is free, any time; an old post goes empty.");
  });
});

// ===== E5-6: the Personnel Refugees tab, the arrival card, the log lines and the first-arrival hint =====

// The mockup's section 3 homeworld: 11 posts, 5 posted, 5 waiting, 6 open; the Telescope, the Salvage Bay and Mission
// Control are full.
function tabState(): GameState {
  const s = withLevels(freshState(1), {
    refinery: 4, research: 4, fabricator: 1, fuelStorage: 1, subspaceTelescope: 1, salvageBay: 1, missionControl: 1, shipyard: 4,
  });
  return withPeople(s, [
    person(1, "Mira Talven", "refiner", 42, "refinery"),
    person(2, "Kesia Lunde", "scholar", 58, "research"),
    person(3, "Oriel Vance", "stargazer", 50, "subspaceTelescope"),
    person(4, "Hale Brennick", "salvager", 39, "salvageBay"),
    person(5, "Pell Okafor", "dispatcher", 33, "missionControl"),
    person(6, "Juno Pirelle", "stargazer", 68, null),
    person(7, "Tamsin Corr", "refiner", 61, null),
    person(8, "Neve Ardent", "salvager", 44, null),
    person(9, "Ansel Rook", "refiner", 27, null),
    person(10, "Bex Haddow", "dispatcher", 24, null),
  ]);
}

// Every facility full: one post each at the Refinery, Research Lab, Telescope, Salvage Bay and Mission Control.
function fullState(): GameState {
  return withLevels(tabState(), { shipyard: 0, refinery: 1, fabricator: 0, research: 1, fuelStorage: 0 });
}

function logEntry(kind: CompletionLogEntry["kind"], extra: Partial<CompletionLogEntry>): CompletionLogEntry {
  return {
    id: "done-1", kind, reward: "nothing", atMs: 0, startedAtMs: 0, iterations: 1, items: [], pieces: 0,
    subjectKey: "slot-0", level: null, fuelAmount: null, creditsAmount: null, stale: false, ...extra,
  };
}

describe("refugeesTabVisible (call 13 A, Review Focus 3)", () => {
  it("is hidden until the first arrival and stays once anyone has arrived, even with the list empty", () => {
    expect(refugeesTabVisible(freshState(1))).toBe(false);
    const emptied = { ...freshState(1), refugees: { version: 1 as const, list: [], nextId: 3, arrivedTotal: 2, greet: [] } };
    expect(refugeesTabVisible(emptied)).toBe(true);
    const v = refugeesTabView(emptied, "waiting", "skill");
    expect(v.rows).toEqual([]);
    expect(v.emptyText).toBe("Nobody is here right now. Evacuations on the short-range board bring people home, and they wait here.");
  });
});

describe("refugeesTabView", () => {
  it("counts waiting, posted and the open posts of every post", () => {
    const v = refugeesTabView(tabState(), "waiting", "skill");
    expect([v.waiting, v.posted, v.everyone]).toEqual([5, 5, 10]);
    expect(v.totalPosts).toBe(11);
    expect(v.openPosts).toBe(6);
    const fewer = refugeesTabView(withLevels(tabState(), { shipyard: 0, fuelStorage: 0 }), "everyone", "skill");
    expect(`${fewer.openPosts} of ${fewer.totalPosts}`).toBe("3 of 8");
  });

  it("each waiting row's best post is the engine's best real gain, open or full", () => {
    const s = tabState();
    const v = refugeesTabView(s, "waiting", "skill");
    expect(v.rows.map((r) => r.name)).toEqual(["Juno Pirelle", "Tamsin Corr", "Neve Ardent", "Ansel Rook", "Bex Haddow"]);
    for (const row of v.rows) {
      const best = refugeeBestPost(s, row.id)!;
      expect(row.bestFacility).toBe(best.facility);
      expect(row.bestOpen).toBe(best.open);
      if (best.open) expect(row.bestText.endsWith(` open · ${percentText(best.gain)}`)).toBe(true);
      else expect(row.bestText).toBe("no open post");
    }
    const gain = refugeeBonusIfPosted(s, 7, "refinery").gain;
    const tamsin = v.rows.find((r) => r.name === "Tamsin Corr")!;
    expect(tamsin.bestLabel).toBe("Refinery");
    expect(tamsin.bestText).toBe(`1 open · ${percentText(gain)}`);
    expect(tamsin.bestShort).toBe(`Refinery open, ${percentText(gain)}`);
    expect(tamsin.primary).toBe(true);
    expect(v.rows.filter((r) => r.primary)).toHaveLength(1);
  });

  it("a row whose best facility is full reads no open post, and Post... offers the swap (call 10 A)", () => {
    const s = fullState();
    const v = refugeesTabView(s, "waiting", "skill");
    const juno = v.rows.find((r) => r.name === "Juno Pirelle")!;
    expect(juno.bestFacility).toBe("subspaceTelescope");
    expect(juno.bestText).toBe("no open post");
    expect(juno.bestShort).toBe("Telescope full");
    expect(juno.actionLabel).toBe("Post...");
    const telescope = personPostView(s, 6)!.choices.find((c) => c.facility === "subspaceTelescope")!;
    expect(telescope.open).toBe(false);
    expect(telescope.swaps.map((w) => w.id)).toEqual([3]);
    expect(v.rows.some((r) => r.primary)).toBe(false);
  });

  it("filters and sorts", () => {
    const s = tabState();
    expect(refugeesTabView(s, "posted", "skill").rows.map((r) => r.id)).toEqual([2, 3, 1, 4, 5]);
    expect(refugeesTabView(s, "everyone", "arrived").rows.map((r) => r.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(refugeesTabView(s, "waiting", "background").rows.map((r) => r.backgroundLabel)).toEqual(["Dispatcher", "Refiner", "Refiner", "Salvager", "Stargazer"]);
    const mira = refugeesTabView(s, "posted", "skill").rows.find((r) => r.id === 1)!;
    expect(mira.action).toBe("move");
    expect(mira.actionLabel).toBe("Move...");
    expect(mira.bestText).toBe(`posted · ${percentText(refugeeShare({ background: "refiner", skill: 42 }, "refinery"))} extra output chance`);
  });

  it("shows a calm line when everyone is posted", () => {
    const s = withPeople(withLevels(freshState(1), { refinery: 1 }), [person(1, "Mira Talven", "refiner", 42, "refinery")]);
    expect(refugeesTabView(s, "waiting", "skill").emptyText).toBe("Nobody is waiting: everyone at home is posted.");
  });
});

describe("slowArrivalsLine (call 9 A)", () => {
  it("appears only while the waiting list is longer than the open posts, and holds no number", () => {
    const s = tabState(); // 5 waiting, 6 open
    expect(slowArrivalsLine(s)).toBe("");
    expect(refugeesTabView(s, "waiting", "skill").calm).toContain("Evacuations keep bringing people home.");
    const slow = fullState(); // 5 waiting, 0 open
    const line = slowArrivalsLine(slow);
    expect(line).not.toBe("");
    expect(line).not.toMatch(/\d/);
    const v = refugeesTabView(slow, "waiting", "skill");
    expect(v.calm).toContain(line);
    expect(v.calmShort).toBe("5 waiting, 0 open posts. Everyone is safe here. Evacuations keep bringing people home, a little less often while this list outgrows your open posts.");
  });
});

describe("arrivalCardView (call 11 A)", () => {
  it("offers a one-tap post at the best open post, with the engine's gain", () => {
    const s = tabState();
    const v = arrivalCardView(s, 7)!; // Tamsin, a refiner; the Refinery has an open post
    const best = refugeeBestOpenPost(s, 7)!;
    expect(best.facility).toBe("refinery");
    expect(best.gain).toBe(refugeeBonusIfPosted(s, 7, "refinery").gain);
    expect(v.headline).toBe("Tamsin Corr joins your homeworld");
    expect(v.matchText).toBe("suits Refinery");
    expect(v.matched).toBe(true);
    expect(v.post).toEqual({ facility: "refinery", gain: best.gain, label: `Post at the Refinery (${percentText(best.gain)})`, shortLabel: "Post at Refinery" });
    expect(v.laterLabel).toBe("Leave on the waiting list");
    expect(v.toastLine).toBe("Evacuation complete: Tamsin Corr, a refiner, joins your homeworld.");
    for (const f of ["fabricator", "shipyard", "research", "fuelStorage"] as RefugeeFacilityKey[]) {
      expect(refugeeBonusIfPosted(s, 7, f).gain).toBeLessThanOrEqual(best.gain);
    }
  });

  it("offers the chooser when no post is open, and greeting removes the id from greet", () => {
    expect(arrivalCardView(fullState(), 6)!.post).toBeNull();
    const base = tabState();
    const s = { ...base, refugees: { ...base.refugees!, greet: [7, 9] } };
    expect(arrivalCardIds(s)).toEqual([9, 7]);
    const g = greetRefugee(s, 9);
    expect(g.refugees!.greet).toEqual([7]);
    expect(arrivalCardIds(g)).toEqual([7]);
    // After a one-tap post the card leaves (the person is no longer waiting).
    const posted = postRefugee(g, 7, "refinery").next;
    expect(arrivalCardIds(posted)).toEqual([]);
    expect(arrivalCardView(posted, 7)).toBeNull();
  });

  it("posting by any path greets the person, so an unpost or a swap never brings the arrival card back", () => {
    const base = tabState();
    const s = { ...base, refugees: { ...base.refugees!, greet: [7, 9] } };
    // Arrive, post from the strip (the same engine call every path runs), then unpost: no card returns.
    const posted = postRefugee(s, 7, "refinery").next;
    expect(posted.refugees!.greet).toEqual([9]);
    const back = unpostRefugee(posted, 7).next;
    expect(back.refugees!.list.find((r) => r.id === 7)!.posting).toBeNull();
    expect(arrivalCardIds(back)).toEqual([9]);
    // A failed post greets nobody.
    const failed = postRefugee(s, 9, "nope" as RefugeeFacilityKey);
    expect(failed.success).toBe(false);
    expect(failed.next.refugees!.greet).toEqual([7, 9]);
  });
});

describe("the refugee log lines (calls 11 A and 12 A)", () => {
  it("wears the final glyphs, and an evacuation that brings nobody home is a neutral line", () => {
    const s: GameState = {
      ...freshState(1),
      completionLog: [
        logEntry("refugeeNoArrival", { id: "done-1", refugeeOrigin: { tier: 1, destinationIndex: 0 } }),
        logEntry("refugeeArrival", { id: "done-2", refugee: { id: 1, name: "Tamsin Corr", background: "refiner" }, refugeeOrigin: { tier: 2, destinationIndex: 0 } }),
        logEntry("refugeeFarewell", { id: "done-3", refugee: { id: 2, name: "Silas Wren", background: "scholar" }, refugeeOrigin: { tier: 1, destinationIndex: 0 } }),
      ],
    };
    const rows = buildHomeDashboard(s).recentlyCompleted;
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by("done-2").icon).toBe("refugeeArrival");
    expect(by("done-2").primaryLabel).toBe("Evacuation complete: Tamsin Corr, a refiner, joins your homeworld.");
    expect(by("done-2").jumpTarget).toBe("refugees");
    expect(by("done-3").icon).toBe("refugeeFarewell");
    expect(by("done-3").jumpTarget).toBe("refugees");
    const miss = by("done-1");
    expect(miss.icon).toBe("refugeeNoArrival");
    expect(miss.primaryLabel).toMatch(/^Evacuate .* complete\. Everyone aboard reached the camps; nobody new came home this time\.$/);
    expect(miss.primaryLabel).not.toMatch(/fail|lost|missed/i);
    expect(miss.secondaryLabel).toBeNull();
  });
});

describe("firstArrivalHintView (call 14 A)", () => {
  it("shows once after the first arrival and never after it is dismissed", () => {
    expect(firstArrivalHintView(freshState(1))).toBeNull();
    const s = withPeople(withLevels(freshState(1), { refinery: 2, research: 1 }), [person(1, "Ansel Rook", "refiner", 27, null)]);
    expect(firstArrivalHintView(s)!.text).toBe("Rescued people can work at your facilities. Post Ansel Rook at the Refinery for the strongest boost.");
    const dismissed = dismissRefugeeHint(s);
    expect(dismissed.refugees!.hintSeen).toBe(true);
    expect(firstArrivalHintView(dismissed)).toBeNull();
    // A later arrival never brings it back.
    const r = dismissed.refugees!;
    const later = { ...dismissed, refugees: { ...r, list: [...r.list, person(2, "Bex Haddow", "dispatcher", 24, null)], arrivedTotal: 2 } };
    expect(firstArrivalHintView(later)).toBeNull();
  });
});
