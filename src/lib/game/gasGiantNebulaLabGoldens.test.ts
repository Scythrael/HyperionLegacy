// Gas Giant Study GG-4 (nebulae) and GG-5 (the Research Lab study lane): golden hashes captured on feat/crew-0.14.0
// bc25a23, BEFORE either engine edit (docs/plans/2026-10-17-gas-giant-study-plan.md, the brief's "goldens first").
// Whole serialized records, never a narrow subset:
//
//   1. nebula sweep capture: every region tier (I to VII), every candidate slot and two save seeds, crewed with two
//      Ground teams: the tier's candidate list (G2 candidate identity: GG-4's nebula draw sits outside it), the
//      dispatch record, the finished run and the claim's deposits. GG-4 stamps `Expedition.nebula` on a system whose
//      own draw finds one, and the ship sweeps it after the bodies; with that stamp taken off (withoutNebula) every
//      dispatch record and every run must read exactly this capture.
//   2. lab capture: a save holding research data and an Ancient Data Fragment, the Research Lab at Level 1, stepped an
//      hour (tick: economyTick(state, 1) per second). Before GG-5 nothing uses the data, so nothing moves. GG-5's lane
//      auto-studies held data unless paused: with the pause on, the hour must read exactly this capture (the pause flag
//      itself taken off).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { RESEARCH_FACILITY_KEY, SUBSPACE_TELESCOPE_FACILITY_KEY, freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { tick } from "./tick";
import { addItemQuality } from "./inventory";
import { ANCIENT_DATA_FRAGMENT_ID, RESEARCH_DATA_ITEM, RESEARCH_FAMILIES } from "./gasGiantContent";
import { asPreRelicBlanksDispatch, dispatchPastPropulsion, plainAwayMember } from "./awayTeamTestFixtures";
import { goldenJson } from "./firstRunsGoldens.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
const hash = (v: unknown): string => fnv(goldenJson(v));

const T0 = 100_000;
const FINAL = T0 + 8_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members, the telescope at Level 8 (gasGiantStudyGoldens.test.ts crewed).
function crewed(saveSeed: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    expeditionSeed: saveSeed,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// GG-4: the dispatch record WITHOUT its nebula stamp (`Expedition.nebula`): the record the same dispatch made before
// GG-4 (a run in flight at the update). The stamp is the one key GG-4 adds at dispatch. Identity without it. Pure.
function withoutNebula(exp: Expedition): Expedition {
  if (!("nebula" in exp)) return exp;
  const rest = { ...exp } as Expedition & { nebula?: unknown };
  delete rest.nebula;
  return rest;
}

const SAVE_SEEDS = [0x51f15e, 0x2b7c0d3] as const;
const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;

// One system: [candidate list of its tier, dispatch record, finished run, deposits]. Pure (every run is a throwaway).
function nebulaRow(saveSeed: number, tier: number, slot: number): string[] {
  const state = crewed(saveSeed);
  const id = `cand-${tier}-${slot}`;
  const cands = expeditionCandidates(state, "ship-1", tier as 1);
  expect(cands.find((c) => c.id === id), id).toBeDefined();
  const res = asPreRelicBlanksDispatch(dispatchPastPropulsion(state, "ship-1", 1, id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = withoutNebula(res.expedition);
  const done = advanceExpedition(exp, FINAL);
  expect(done.phase, id).toBe("complete");
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  const deposits = { inventory: claim.next.inventory, credits: claim.next.credits.toString(), surveyLog: claim.next.surveyLog ?? null };
  return [hash(cands), hash(exp), hash(done), hash(deposits)];
}

// Per system: hash of the row's hashes, keyed "<save seed>:<candidate id>".
const NEBULA_CAPTURE: Record<string, string> = {
  "51f15e:cand-1-0": "5f3b2793",
  "51f15e:cand-1-1": "cf653d28",
  "51f15e:cand-1-2": "9a0fc495",
  "51f15e:cand-2-0": "bec281a3",
  "51f15e:cand-2-1": "603d289",
  "51f15e:cand-2-2": "dcea9c45",
  "51f15e:cand-3-0": "c7e96c8f",
  "51f15e:cand-3-1": "1bcf1b96",
  "51f15e:cand-3-2": "8d75dd63",
  "51f15e:cand-4-0": "5354c5ac",
  "51f15e:cand-4-1": "2cc5c4aa",
  "51f15e:cand-4-2": "66f0a7fe",
  "51f15e:cand-5-0": "93031333",
  "51f15e:cand-5-1": "44e6d384",
  "51f15e:cand-5-2": "c8e2b266",
  "51f15e:cand-6-0": "a1afb89",
  "51f15e:cand-6-1": "3b884e66",
  "51f15e:cand-6-2": "d06ee6b0",
  "51f15e:cand-7-0": "b5c71fcd",
  "51f15e:cand-7-1": "96d79e0f",
  "51f15e:cand-7-2": "ec5d3f7",
  "2b7c0d3:cand-1-0": "2438ecfd",
  "2b7c0d3:cand-1-1": "402895c0",
  "2b7c0d3:cand-1-2": "d652f58b",
  "2b7c0d3:cand-2-0": "8d665c03",
  "2b7c0d3:cand-2-1": "36c511a6",
  "2b7c0d3:cand-2-2": "d2d751bd",
  "2b7c0d3:cand-3-0": "e29bf62e",
  "2b7c0d3:cand-3-1": "ecff821b",
  "2b7c0d3:cand-3-2": "f1d41cc3",
  "2b7c0d3:cand-4-0": "24dc9bd7",
  "2b7c0d3:cand-4-1": "e39eba12",
  "2b7c0d3:cand-4-2": "e119fc1d",
  "2b7c0d3:cand-5-0": "fbedb90c",
  "2b7c0d3:cand-5-1": "d3cf24c2",
  "2b7c0d3:cand-5-2": "3b48473f",
  "2b7c0d3:cand-6-0": "c41184f1",
  "2b7c0d3:cand-6-1": "f95bab0a",
  "2b7c0d3:cand-6-2": "562d0892",
  "2b7c0d3:cand-7-0": "5de9ca86",
  "2b7c0d3:cand-7-1": "57dfb357",
  "2b7c0d3:cand-7-2": "b9461102",
};

describe("GG-4 capture: every tier's systems, dispatched and finished, with no nebula stamp", () => {
  it("two save seeds x seven tiers x three slots", () => {
    const rows: Record<string, string> = {};
    for (const saveSeed of SAVE_SEEDS) {
      for (const tier of TIERS) {
        for (let slot = 0; slot < 3; slot++) rows[`${saveSeed.toString(16)}:cand-${tier}-${slot}`] = hash(nebulaRow(saveSeed, tier, slot));
      }
    }
    expect(rows).toEqual(NEBULA_CAPTURE);
  });
});

// A save holding two of every research data item and one Ancient Data Fragment, the Research Lab at Level 1.
function holdingData(): GameState {
  const base = freshState();
  let inventory = base.inventory;
  for (const f of RESEARCH_FAMILIES) inventory = addItemQuality(inventory, RESEARCH_DATA_ITEM[f], new Decimal(2), 0);
  inventory = addItemQuality(inventory, ANCIENT_DATA_FRAGMENT_ID, new Decimal(1), 0);
  return {
    ...base,
    gameTimeSeconds: T0,
    credits: new Decimal(1e9),
    inventory,
    facilities: { ...base.facilities, [RESEARCH_FACILITY_KEY]: { level: 1 } },
  };
}

const LAB_CAPTURE = "de0d7eb1";

describe("GG-5 capture: a save holding research data, stepped an hour", () => {
  it("the hour's state", () => {
    const after = tick(3600, holdingData(), () => 0.5);
    expect(after.gameTimeSeconds).toBe(T0 + 3600);
    expect(hash(after)).toBe(LAB_CAPTURE);
  });
});
