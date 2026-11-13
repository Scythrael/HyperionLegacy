// Relics v2 R2-5 / R2-6 (docs/plans/2026-10-17-relics-v2-plan.md section 4): the PRE-CONTENT GOLDENS. Tests only,
// captured on the code BEFORE the R2-5 ledger and the R2-6 culture reveal touched the engine (on 0b5892e7). They pin
// what a long identification chain, the grant seam, the data study's culture feed and the set shoutout do today, so the
// content slices prove what they move and what they keep:
//   1. 160 blanks of every region tier (relicsV2Content.fixture.ts: the Museum holding all but the last piece of every
//      exceptional set), queued at once and resolved by the real chain (Lab VII, four lanes): one call and 997 tick
//      chunks land the same whole state; its exceptional sets, cultures (14 of them past ten points) and the named list.
//   2. the grant seam's first exceptional piece on a save holding the other Tier I piece.
//   3. feedCultureData carrying one culture past ten study points.
//   4. the set shoutout line for a completed exceptional set.
// NEVER regenerate these from a later build. A slice that moves one names it and the reason in its commit.

import { describe, it, expect } from "vitest";
import { freshState, type GameState } from "./model";
import { EXCEPTIONAL_SETS } from "./relics";
import { contentGoldenStart, resolveChain } from "./relicsV2Content.fixture";
import { hash, stateHash } from "./firstRunsGoldens.fixture";
import { grant } from "./processSpeed";
import { feedCultureData } from "./dataStudy";
import { setCompletionShoutouts } from "./setShoutouts";

describe("R2-5 / R2-6 content golden 1: a 160-blank identification chain", () => {
  it("one call lands the pinned state", () => {
    const done = resolveChain(contentGoldenStart(), Infinity);
    expect(done.relicVault.length).toBe(0);
    expect(done.museumV2.setsCompleted).toEqual(["exc-t6-b", "exc-t3-b"]);
    expect(done.museumV2.culturesNamed).toEqual([]);
    expect(hash(done.museumV2.cultures)).toBe("a29ddbfa");
    expect(hash(done.museumV2.exceptional)).toBe("98031451");
    expect(stateHash(done)).toBe("7d57df2f");
  });
  it("997 tick chunks land the same whole state", () => {
    const one = resolveChain(contentGoldenStart(), Infinity);
    const chunks = resolveChain(contentGoldenStart(), 997);
    expect(stateHash({ ...chunks, completionLog: [], nextCompletionLogId: 0 } as GameState)).toBe(stateHash({ ...one, completionLog: [], nextCompletionLogId: 0 } as GameState));
    expect(chunks.museumV2).toEqual(one.museumV2);
  });
});

describe("R2-5 content golden 2: the grant seam's first exceptional piece", () => {
  it("on a save holding the other Tier I piece", () => {
    const set = EXCEPTIONAL_SETS.find((x) => x.id === "exc-t1-a")!;
    const s: GameState = { ...freshState(), museumV2: { ...freshState().museumV2, exceptional: { [set.pieces[1].id]: 1 } } };
    const r = grant(s, { relics: [{ kind: "firstExceptional" }] }, "Tutorial reward");
    expect(r.granted).toBe(true);
    expect(r.next.museumV2.exceptional).toEqual({ [set.pieces[1].id]: 1, [set.pieces[0].id]: 1 });
    expect(r.next.museumV2.setsCompleted).toEqual([]);
    expect(r.logLine).toBe("Tutorial reward. Received an exceptional relic.");
    expect(stateHash(r.next)).toBe("8cbd822e");
  });
});

describe("R2-6 content golden 3: ancient data past ten study points", () => {
  it("feedCultureData adds points and names nothing", () => {
    let m = freshState().museumV2;
    for (let i = 0; i < 12; i++) m = feedCultureData(m, "culture-t2-4", 1);
    expect(m.cultures["culture-t2-4"]).toEqual({ points: 12, finds: {} });
    expect(m.culturesNamed).toEqual([]);
  });
});

describe("R2-5 content golden 4: the set shoutout line", () => {
  it("names the completed set", () => {
    const before = freshState();
    const after: GameState = { ...before, museumV2: { ...before.museumV2, setsCompleted: ["exc-t3-b"] } };
    expect(setCompletionShoutouts(before, after)).toEqual(["Set complete: Tier III Exceptional Set B is whole in the Museum."]);
  });
});
