// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lane 3 and the USER ANSWERS of 2026-11-13/14): the
// round's expedition pins, each move named and proven with its switch off (fixRoundESwitch.fixture.ts).
//
// 1. The completion fixtures (completionTracking.fixture.ts, five save seeds; real training runs, so no real star:
//    run with the star rule off, the star's own pins are section 2). BEFORE = the round's four fixes off, which is
//    exactly completionRollGoldens.test.ts's GOLDEN pins (that file runs with the round off). Moves:
//    R = RECALL_NO_REPAY_SWITCH (lane 3 I1): the recall cut its second body short after rolling some of its scan
//        boundaries, so the held Resume system keeps HeldSystem.scanStepsRolled (the late recall and the claim once
//        home move), and the resumed run skips those boundaries (its claim no longer re-pays their supply caches or ship
//        events). The abandon does not move (the held record is dropped).
//    P = PLANET_ROLL_REAL_OBJECTIVE_SWITCH (lane 3 q3): the skip recall's abandon: body 1's objectives were all
//        skipped, so it is 100% (the % still counts skips) but pays no planet roll (no completion blank, no
//        bodiesRolled). Its resumed claim does not move: the resumed run really finishes them, so the roll pays there.
//    The list rule (I3) moves none of these (each recall here comes after its window opened, so something is charted).
// 2. The star rule (lane 3 I2): Wolf 359 (the guaranteed slot 0 of the first list after the first run) launched from
//    three saves has the same bodies; with the rule off, each launch has its slot's bodies. A catalog-named system's
//    run is byte-identical with the rule on and off.

import { describe, expect, it } from "vitest";
import { STAR_BODIES_SWITCH, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { CT_SEEDS, ctClaimed, ctHash, ctRecalled, ctResumed, ctSkipRecalled } from "./completionTracking.fixture";
import { withFixRoundEExpeditionsOff, withPlanetRollRealObjectiveOff, withRecallNoRepayOff, withStarBodiesOff } from "./fixRoundESwitch.fixture";
import { advanceExpedition, startExpedition, tierCandidateSystems } from "./expedition";
import { WOLF_359_ID } from "./starCatalog";
import { installMissingCombatBaselines } from "./tick";
import { plainAwayMember } from "./awayTeamTestFixtures";
import { fnv } from "./firstRunsGoldens.fixture";

const hashes = (seed: number): string[] => {
  const r = ctRecalled(seed, "bodyDone");
  const s = ctSkipRecalled(seed);
  return [
    ctHash(ctClaimed(seed)),
    ctHash(r.recalled),
    ctHash(r.claimed),
    ctHash(r.abandoned),
    ctHash(ctResumed(seed, "charted").claimed),
    ctHash(ctResumed(seed, "bodyDone").claimed),
    ctHash(s.recalled),
    ctHash(s.claimed),
    ctHash(s.abandoned),
    ctHash(s.resumed),
  ];
};
// [the claim, the late recall, its claim, its abandon, the resumed claim after the early recall and after the late one,
// the skip recall, its claim, its abandon, its resumed claim]

// = completionRollGoldens.test.ts GOLDEN_CLAIMS, GOLDEN_LATE_RECALLS, GOLDEN_RESUMED and GOLDEN_SKIP_RECALLS.
const BEFORE: Record<string, string[]> = {
  "1001": ["59d462e3", "779ac891", "e86635e3", "58a7ec5f", "12637af6", "ec23ee82", "35cc2fd9", "3bbdccbc", "31d5064e", "b51f422c"],
  "2002": ["8d2c752d", "ead68082", "f77173ce", "b08d8efa", "bd6acb9", "27125874", "a3b823e6", "cf043fa8", "9ccab2bf", "3796db2b"],
  "3003": ["cdfdc087", "7e56ae14", "eb42c43e", "5ca8a1ed", "fcf47c2d", "563a6b50", "e9c50f52", "f1f16967", "c10e440a", "24f4979b"],
  "4004": ["4374e167", "868117d3", "4ac282cf", "5caa373c", "578b30ff", "6b609cb2", "4ba669fb", "be283fc6", "24d06542", "428b48dd"],
  "5005": ["e346f2c4", "d645b68e", "7a617377", "84d943c8", "f6ddfbca", "3b70bb4e", "2fb18b58", "74d5d1d6", "1bf9cf40", "4bd8e5bc"],
};
// The pins with the round. Moved (see the header): R at 1, 2 (and 5 where the resumed run reaches a skipped boundary:
// 1001, 3003); P at 8.
const GOLDEN: Record<string, string[]> = {
  "1001": ["59d462e3", "9f29c600", "8a86398a", "58a7ec5f", "12637af6", "5f3cb0f0", "35cc2fd9", "3bbdccbc", "23cac6eb", "b51f422c"],
  "2002": ["8d2c752d", "ead68082", "f77173ce", "b08d8efa", "bd6acb9", "27125874", "a3b823e6", "cf043fa8", "d67e4d90", "3796db2b"],
  "3003": ["cdfdc087", "db5a45d7", "6866ccd5", "5ca8a1ed", "fcf47c2d", "ec764db2", "e9c50f52", "f1f16967", "4b0895fa", "24f4979b"],
  "4004": ["4374e167", "868117d3", "4ac282cf", "5caa373c", "578b30ff", "6b609cb2", "4ba669fb", "be283fc6", "5f67e0b8", "428b48dd"],
  "5005": ["e346f2c4", "4de74e69", "f9c8696c", "84d943c8", "f6ddfbca", "3b70bb4e", "2fb18b58", "74d5d1d6", "4ddb6bec", "4bd8e5bc"],
};
// Which fix moves each pin (R, P, or "-" for none), per seed.
const MOVED_BY: Record<string, string> = {
  "1001": "-,R,R,-,-,R,-,-,P,-",
  "2002": "-,-,-,-,-,-,-,-,P,-",
  "3003": "-,R,R,-,-,R,-,-,P,-",
  "4004": "-,-,-,-,-,-,-,-,P,-",
  "5005": "-,R,R,-,-,-,-,-,P,-",
};

describe("FR-E completion fixtures (the star rule off: these are not real stars' pins)", () => {
  const starWas = STAR_BODIES_SWITCH.live;
  const starOff = <T>(run: () => T): T => {
    STAR_BODIES_SWITCH.live = false;
    try {
      return run();
    } finally {
      STAR_BODIES_SWITCH.live = starWas;
    }
  };
  for (const seed of CT_SEEDS) {
    const key = seed.toString(16);
    it(`${key}: the pins with the round`, { timeout: 300_000 }, () => expect(starOff(() => hashes(seed))).toEqual(GOLDEN[key]));
    it(`${key}: the round off returns every capture`, { timeout: 300_000 }, () => expect(withFixRoundEExpeditionsOff(() => hashes(seed))).toEqual(BEFORE[key]));
    it(`${key}: each move is its own fix's`, { timeout: 600_000 }, () => {
      const on = GOLDEN[key];
      const noRepay = starOff(() => withRecallNoRepayOff(() => hashes(seed)));
      const roll = starOff(() => withPlanetRollRealObjectiveOff(() => hashes(seed)));
      const moved = on.map((h, i) => (h === BEFORE[key][i] ? "-" : `${noRepay[i] !== h ? "R" : ""}${roll[i] !== h ? "P" : ""}`)).join(",");
      expect(moved).toBe(MOVED_BY[key]);
    });
  }
});

// ===== 2. The star rule =====

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
function crewed(expeditionSeed: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return installMissingCombatBaselines({
    ...base,
    expeditionSeed,
    gameTimeSeconds: 100_000,
    nextExpeditionId: 1,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: "orion" as const, groundTeams: teams })),
  });
}
// The second launch of a fresh save, from the list after the first run (Wolf 359 on slot 0, guaranteed). Pure.
function wolfLaunch(expeditionSeed: number): Expedition {
  const first = startExpedition(crewed(expeditionSeed), "ship-1", 1, "cand-1-1");
  expect(first.success, first.reason).toBe(true);
  const s = { ...first.next, expeditions: [] };
  expect(tierCandidateSystems(s, 1)[0].famousId).toBe(WOLF_359_ID);
  const res = startExpedition(s, "ship-1", 1, "cand-1-0");
  expect(res.success, res.reason).toBe(true);
  return res.expedition!;
}
const shape = (e: Expedition): string => JSON.stringify(e.bodies.map((b) => [b.planetType, b.scanTotal, b.hazard]));

// Wolf 359's bodies with the star rule (the same from every save).
const WOLF_359_BODIES = '[["toxic",88,0.9],["arid",160,0.25],["frozen",128,0.4]]';

describe("FR-E the star rule: a real star is the same system every visit", () => {
  const SAVES = [0x101, 0x202, 0x303];
  it("Wolf 359 from three saves: the same bodies with the rule; its slot's own draw without it", () => {
    const withRule = SAVES.map((s) => shape(wolfLaunch(s)));
    expect(withRule).toEqual(SAVES.map(() => WOLF_359_BODIES));
    const without = SAVES.map((s) => withStarBodiesOff(() => shape(wolfLaunch(s))));
    expect(new Set(without).size).toBeGreaterThan(1);
  });
  it("a catalog-named system's run is byte-identical with the rule on and off, through its claim", () => {
    const s = crewed(0x404);
    const cand = tierCandidateSystems(s, 1).find((c) => c.famousId === null)!;
    const run = (): string => {
      const res = startExpedition(s, "ship-1", 1, cand.id);
      expect(res.success, res.reason).toBe(true);
      return fnv(JSON.stringify(advanceExpedition(res.expedition!, 4_000_000)));
    };
    expect(run()).toBe(withStarBodiesOff(run));
  });
});
