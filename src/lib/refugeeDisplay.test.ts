// E5-5 (plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-5): the Posts strip and the post picker views.
// Every number is checked against the engine (refugeeShare, refugeeFacilityBonus, refugeeBonusIfPosted, postRefugee).

import { describe, expect, it } from "vitest";
import { freshState, type GameState } from "./game/model";
import { postRefugee, refugeeShare, type RefugeeBackground, type RefugeeFacilityKey, type RefugeeRecord } from "./game/refugees";
import { refugeeBonusIfPosted, refugeeFacilityBonus } from "./game/refugeeBuffs";
import {
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
