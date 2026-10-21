// Expedition Tiers G2-0 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-0): golden hashes captured on
// the code BEFORE any Expedition Tiers engine edit (on top of 3ce5404). Every later slice (G2-1 to G2-9) keeps these
// green in the same commit, or re-pins one ONLY where the slice names the move and why (G2-1: golden 3's distances;
// G2-2: golden 2 with the pre-G2 names restored; G2-3: golden 2 with `voyage` deleted). Whole serialized records,
// never a narrow subset:
//
//   1. stored  : two in-flight runs restored from a v69 save of their STORED records (expeditionTiersGoldens.fixture.ts):
//                a flagged run (Ground Ops + risk + affixed objectives) and a pre-Ground-Ops legacy run. Each is hashed
//                at five checkpoints read off its own phase timeline (transit midpoint, arrival, mid-scan, window end,
//                claim), plus the timeline itself.
//   2. fresh   : freshState with a slotted crew (two Ground teams, rank 10), candidates 0, 1 and 2 dispatched, as the
//                shakedown (expedition 1) and as a regular run (expedition 2): the dispatch record, the phase anchors,
//                the findings, the objectives, the fights (the step history and ship legs), the finished run and the
//                claimed state.
//   3. display : expeditionCandidates (seeds, names, foreknowledge, telescope readings) at telescope Levels 0, 1, 5
//                and 8; each candidate's risk preview; the launch view (task demand, recommendation, forecast) at
//                Levels 5 and 8; the telescope reading at Levels 0 to 8; telescopeCardView and telescopeMapView at
//                Levels 1 and 8.
//   4. reach   : shipRangeLightYears for every hull, and shipReachesRoundTrip, shipTripRangeLightYears and the
//                dispatch gate (canDispatch / canDispatchPatrol) for every hull x every mission and patrol, with the
//                starting gear and with a +300 Fuel Capacity drive (extends fuel-to-reach.test.ts); and the whole Tier I
//                startExpedition result from every hull, stock and boosted (all 20 launch).
// Plus offline == live parity on the golden 1 and 2 runs: one call == 997 s chunks == 1 s steps across arrival ==
// an EVENT-BOUNDARY chain (t - 1, t, t + 1 at every phase anchor, step record, log line and ship leg).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  freshState,
  MISSIONS,
  PATROLS,
  SHIP_TYPES,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  type AwayMember,
  type Expedition,
  type GameState,
  type MissionKey,
  type PatrolKey,
  type ShipGroundTeam,
  type ShipTypeKey,
} from "./model";
import { advanceExpedition, advanceExpeditionSeed, claimExpedition, expeditionCandidates, expeditionLaunchView, expeditionRiskPreview, startExpedition, type ExpeditionCandidate } from "./expedition";
import { PROVISIONAL_HOMEWORLD, stateHomeworld, type HomeworldPlacement } from "./galaxy";
import { famousSystem } from "./starCatalog";
import { canDispatch, canDispatchPatrol, installMissingCombatBaselines, shipRangeLightYears, shipReachesRoundTrip, shipTripRangeLightYears } from "./tick";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { telescopeReadingAtLevel } from "./telescope";
import { telescopeCardView, telescopeMapView } from "../telescopeCardDisplay";
import { asPreG2Candidate as asPreG2CandidateFixture, asPreG2NamesDispatch, asPreRanksDispatch, asPreSafeFirstRunsDispatch, plainAwayMember, withSlottedAwayTeams } from "./awayTeamTestFixtures";
import { PRE_G2_STORED_RUNS } from "./expeditionTiersGoldens.fixture";
import { withV1Museum } from "./firstRunsGoldens.fixture";

// ===== shared helpers =====

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const hash = (v: unknown): string => fnv(JSON.stringify(v));

const T0 = 100_000;
const FINAL = T0 + 2_000_000;
const PRE_G2_SAVE_VERSION = 69;
const PHASES = ["transit", "scanning", "activities", "return", "complete"];
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// The run WITHOUT the G2 run fields (plan section 3 "Feature flags": `voyage`, `recall`, `burn`). None exist at
// G2-0, so today the result deep-equals its input; G2-3 / G2-5 / G2-8 runs pass through it. Pure: a shallow copy.
function withoutG2Run(exp: Expedition): Expedition {
  const rest = { ...exp } as Record<string, unknown>;
  delete rest.region; // G2-2's stamp
  delete rest.voyage;
  delete rest.recall;
  delete rest.burn;
  return rest as unknown as Expedition;
}

// The state WITHOUT the G2 state fields (G2-1's stored `homeworld`) and with every run through withoutG2Run. A
// no-op at G2-0; it lets golden 1's claim stay byte-identical across the v70 bump. Pure: shallow copies.
// SF-1: also without the run counters (`runCounts`: seeded by freshState, written by a claim), absent before SF-1.
// Relics v2 R2-1: and with the Museum v2 record in its v1 form (withV1Museum: the v69 save's `relicMuseum`, which
// the v69 -> v70 step moves back), so the claim hashes and the restored save are the pre-R2-1 ones.
function withoutG2State(state: GameState): GameState {
  const rest = { ...withV1Museum(state) } as Record<string, unknown>;
  delete rest.homeworld;
  delete rest.runCounts;
  return { ...(rest as unknown as GameState), expeditions: state.expeditions.map(withoutG2Run) };
}

// ship-1 with two Ground teams of six rank 10 members (3 Security + 3 Science each), the clock at T0. freshState's
// expedition seed, so the candidates are a new save's own.
function crewed(nextExpeditionId: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The legacy fixture's crew: a rank 3 Security member, a rank 2 field medic and one Science member, slotted.
function legacyCrew(): GameState {
  return withSlottedAwayTeams({
    ...freshState(),
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    awayMembers: [
      { ...plainAwayMember("member-1", "security", "ship-1"), rank: 3 },
      { ...plainAwayMember("member-2", "security", "ship-1"), rank: 2, traits: ["fieldMedic"] },
      plainAwayMember("member-11", "science", "ship-1"),
    ],
    nextAwayMemberId: 100,
  });
}

// The state a save held with `exp` in flight (the dispatch's exact `next`: the run listed, the expedition number and
// the seed advanced), cut back to the v69 shape (withoutG2State, so from G2-1 on the save truly lacks `homeworld`
// and the v69 -> v70 migration really seeds it), written to a save, stamped v69 and loaded back through migrate.
// G2-1 gave migrate an injected entropy argument: this call passes a fixed value (G2_1_ENTROPY), and golden 1 checks
// the migration really seeded the homeworld from it. Pure.
const G2_1_ENTROPY = 0x1234abcd;
function restored(crew: GameState, exp: Expedition): GameState {
  const held: GameState = { ...crew, nextExpeditionId: crew.nextExpeditionId + 1, expeditionSeed: advanceExpeditionSeed(crew.expeditionSeed), expeditions: [exp] };
  const save = deserialize(serialize(withoutG2State(held), 0)) as SaveFile;
  expect("homeworld" in save.state).toBe(false);
  return migrate({ ...save, version: PRE_G2_SAVE_VERSION }, G2_1_ENTROPY);
}

// Advance in `step` second chunks from `from` to `to` (inclusive of `to`).
function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

// The run's phase timeline: [phase, anchor] for every phase it enters, read by walking 101 s chunks to completion
// (every phase lasts far longer than 101 s, and the walk asserts each of the five is seen, in order).
function timeline(exp: Expedition): [string, number][] {
  const out: [string, number][] = [[exp.phase, exp.phaseAnchorSeconds]];
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 101; e.phase !== "complete" && t < FINAL; t += 101) {
    e = advanceExpedition(e, t);
    if (out[out.length - 1][0] !== e.phase) out.push([e.phase, e.phaseAnchorSeconds]);
  }
  expect(out.map(([p]) => p)).toEqual(PHASES);
  return out;
}

const anchorOf = (tl: [string, number][], phase: string): number => tl.find(([p]) => p === phase)![1];

// Every recorded event time of the finished run before `to`: each phase anchor, each step record's start and end,
// each log line, each ship leg's and field repair's times. Sorted, unique, inside (T0 + 1, to - 1). Pure.
function eventTimes(done: Expedition, tl: [string, number][], to: number): number[] {
  const times = new Set<number>(tl.map(([, t]) => t));
  const ops = done.groundOps;
  for (const r of ops?.history ?? []) for (const t of [r.startedAt, r.endedAt]) times.add(t);
  for (const l of ops?.log ?? []) times.add(l.at);
  for (const leg of ops?.shipLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
  for (const leg of ops?.repairLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.repairedAt, leg.endsAt]) times.add(t);
  return [...times].filter((t) => Number.isFinite(t) && t > T0 + 1 && t + 1 < to).sort((a, b) => a - b);
}

// one call == 997 s chunks == 1 s steps over the 600 s around arrival == the event-boundary chain. `exp` untouched.
function expectParity(exp: Expedition): void {
  const frozen = structuredClone(exp);
  const tl = timeline(exp);
  const end = anchorOf(tl, "complete") + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, T0, end, 997)).toEqual(one);
  const arrival = anchorOf(tl, "scanning");
  const from = Math.floor(arrival) - 300;
  expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  let e = exp;
  for (const t of eventTimes(one, tl, end)) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
  expect(advanceExpedition(e, end)).toEqual(one);
  expect(exp).toEqual(frozen);
}

// A telescope at `level` (0 = none built) on `base`.
function atLevel(level: number, base: GameState): GameState {
  return { ...base, facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level } } };
}

// ===== the goldens =====

// Captured on the code BEFORE any Expedition Tiers engine edit (G2-0, on top of 3ce5404). Layouts: stored = [timeline,
// transit midpoint, arrival, mid-scan, window end, claim]; fresh = [dispatch record, timeline, findings, objectives,
// fights, finished run, claim]. Cross-check: the stored flagged record IS the regular cand-0 dispatch, so its
// timeline and claim equal fresh:regular:cand-0's (5a7a918b, 4502111d).
const GOLDEN: Record<string, string[]> = {
  "stored:flagged": ["5a7a918b", "5a4c98ee", "30cdaff5", "a1a964c6", "af11c93d", "62735fe0"],
  "stored:legacy": ["b6f6ef9", "cf4981df", "6219aff8", "98de1f81", "339278d", "a7a2e5a5"],
  "fresh:shakedown:cand-0": ["d989224b", "71bf5b40", "bcba23ec", "f76c2227", "ff015e8a", "e60db926", "9bf89e99"],
  "fresh:shakedown:cand-1": ["fa307f8e", "740b05ec", "4149d5e3", "3eda30ac", "3fd36503", "b856dcf7", "9d293fb2"],
  "fresh:shakedown:cand-2": ["7b93334b", "e759695a", "1406ac88", "8308ef01", "60e1864a", "3dd6eac3", "9ec416ac"],
  "fresh:regular:cand-0": ["ffa69009", "5a7a918b", "5d234ce9", "9bb3228a", "676725c6", "52c3393d", "62735fe0"],
  "fresh:regular:cand-1": ["689ff5a4", "7aac9305", "a239956b", "c5e2e95e", "4fda7266", "f8c60fa", "86e5cdc7"],
  "fresh:regular:cand-2": ["93b332c5", "f23b02ce", "a6f5bf49", "e0952b74", "ee5ca826", "e8b83c3e", "7f5f0fd3"],
  "display:candidates": [
    "L0:3d3c8b21", "62bcf2ed", "30626891", "4cf0ac35", "L1:8207442a", "27f0464d", "e0f76335", "cf6db03a", "L5:e7403ea0",
    "af03b8bf", "e7eb36d1", "7b34ec3a", "L8:7fb6e44e", "82735f", "3fc57679", "f5ddbd0a", "risk:6aeb78c",
    "risk:1686e1ad", "risk:d66c6828",
  ],
  "display:launch": ["b4d99ab5", "25f32e71", "8105e2b", "a44bfe48", "8f8520b2", "b956de0c"],
  "display:telescope": [
    "cffd5b3a", "164e7dfc", "363ef743", "25ad175f", "7f465550", "2b693a80", "c730d797", "dbf9821d", "a7cf78e7",
    "card1:76ff8458", "map1:d0521360", "card8:945210e7", "map8:7ffc445a",
  ],
  reach: [
    "stock:generalFreighter:4694e7b2", "stock:prospectorHauler:a681ea98", "stock:prospectorRunner:68eacc9b",
    "stock:prospectorMiner:8900e380", "stock:destroyer:1c26ab", "stock:battleship:9a2d10d", "stock:carrier:dda1431b",
    "stock:orion:a07e95f8", "stock:aurora:bc938d06", "stock:eir:834764b6", "boost:generalFreighter:8e63d38a",
    "boost:prospectorHauler:8c0cd99e", "boost:prospectorRunner:4650dd30", "boost:prospectorMiner:4f235392",
    "boost:destroyer:10a5b5f8", "boost:battleship:8b69daf4", "boost:carrier:9b6ffe04", "boost:orion:2494db82",
    "boost:aurora:940c80c6", "boost:eir:be786422",
  ],
  "reach:expedition": [
    "stock:generalFreighter:5399eed2", "stock:prospectorHauler:6b03a676", "stock:prospectorRunner:2d91eac",
    "stock:prospectorMiner:24858519", "stock:destroyer:dfedda10", "stock:battleship:d37e2885",
    "stock:carrier:2750ad0b", "stock:orion:1ed04e20", "stock:aurora:b735b817", "stock:eir:44a75fd7",
    "boost:generalFreighter:f3f44add", "boost:prospectorHauler:109a9039", "boost:prospectorRunner:cc903183",
    "boost:prospectorMiner:185b8d7a", "boost:destroyer:a6b3809b", "boost:battleship:f1eb9ec4", "boost:carrier:5be68b6",
    "boost:orion:1f1212bb", "boost:aurora:e174ea8c", "boost:eir:157e5624",
  ],
};

// ===== 1. legacy in-flight runs, restored from their stored records =====

const STORED: Record<"flagged" | "legacy", { crew: () => GameState; check: (exp: Expedition, done: Expedition) => void }> = {
  flagged: {
    crew: () => crewed(2),
    check: (exp, done) => {
      expect(exp.groundOps).toBeDefined();
      expect(exp.risk?.affixCatalog).toBe(2);
      expect(exp.shakedown).toBe(false);
      expect(done.bodies.flatMap((b) => b.activities).some((a) => (a.affixes ?? []).length > 0)).toBe(true);
      expect(done.groundOps!.history.some((r) => r.outcome !== undefined)).toBe(true);
    },
  },
  legacy: {
    crew: legacyCrew,
    check: (exp, done) => {
      expect("groundOps" in exp).toBe(false);
      expect(done.findings.length).toBeGreaterThan(0);
    },
  },
};

describe("G2-0 golden 1: legacy in-flight runs restored from their stored records", () => {
  for (const [name, f] of Object.entries(STORED)) {
    it(`${name}: transit midpoint, arrival, mid-scan, window end and claim match the pre-G2 capture`, () => {
      const stored = structuredClone(PRE_G2_STORED_RUNS[name as "flagged" | "legacy"]) as Expedition;
      const state = restored(f.crew(), stored);
      expect(state.homeworld).toEqual({ version: 1, seed: G2_1_ENTROPY }); // G2-1: the v69 -> v70 step ran
      const exp = state.expeditions[0];
      expect(exp).toEqual(stored);
      expect(withoutG2Run(exp)).toEqual(exp);
      const tl = timeline(exp);
      const arrival = anchorOf(tl, "scanning");
      const windowEnd = exp.groundOps ? advanceExpedition(exp, FINAL).groundOps!.endedAt! : anchorOf(tl, "return");
      expect(windowEnd).toBe(anchorOf(tl, "return"));
      const points = [Math.floor((T0 + arrival) / 2), arrival, Math.floor((arrival + anchorOf(tl, "activities")) / 2), windowEnd];
      const done = advanceExpedition(exp, FINAL);
      f.check(exp, done);
      const claim = claimExpedition({ ...state, expeditions: [done] }, done.id);
      expect(claim.success).toBe(true);
      const out = [hash(tl), ...points.map((t) => hash(advanceExpedition(exp, t))), hash(withoutG2State(claim.next))];
      expect(out).toEqual(GOLDEN[`stored:${name}`]);
    });

    it(`${name}: one call == 997 s chunks == 1 s steps == the event-boundary chain`, () => {
      const stored = structuredClone(PRE_G2_STORED_RUNS[name as "flagged" | "legacy"]) as Expedition;
      expectParity(restored(f.crew(), stored).expeditions[0]);
    });
  }
});

// ===== 2. fresh dispatches =====

// Expedition Tiers G2-2 (plan G2-2: "Tier I dispatch with names restored == G2-0 golden 2"): every fresh dispatch here
// goes through asPreG2NamesDispatch, which gives the run its pre-G2 banked name back and drops its region stamp; the
// rest of the record (bodies, risk, objectives, fights, the x1 Tier I haul) is untouched, so the hashes stand.
// Field Kits FKR-1: every fresh dispatch here is the run as dispatched before enemy ranks (the flag off), so golden 2
// and golden 4 keep their capture; ranked runs are groundOpsRanks.test.ts's business. Safe first runs SF-2: and as
// dispatched before SF-2 (asPreSafeFirstRunsDispatch: no training stamp, the retired 30 minute shakedown back on
// expedition 1), so the shakedown rows keep proving the in-flight path; the training run is
// safeFirstExpedition.test.ts's business.
function freshRun(nextExpeditionId: number, candidateId: string): { exp: Expedition; done: Expedition; tl: [string, number][]; claimed: GameState } {
  const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(crewed(nextExpeditionId), "ship-1", 1, candidateId))));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  const exp = res.expedition;
  const tl = timeline(exp);
  const done = advanceExpedition(exp, FINAL);
  const claim = claimExpedition({ ...res.next, expeditions: [done] }, done.id);
  expect(claim.success).toBe(true);
  return { exp, done, tl, claimed: claim.next };
}

describe("G2-0 golden 2: fresh dispatches of candidates 0, 1 and 2, full timelines through claim", () => {
  for (const [label, nextId] of [["shakedown", 1], ["regular", 2]] as const) {
    for (const cand of ["cand-0", "cand-1", "cand-2"]) {
      it(`${label} ${cand}: dispatch, phase anchors, findings, objectives, fights, the finished run and the claim`, () => {
        const { exp, done, tl, claimed } = freshRun(nextId, cand);
        expect(exp.shakedown).toBe(nextId === 1);
        expect(exp.groundOps).toBeDefined();
        expect(exp.risk).toBeDefined();
        const objectives = done.bodies.map((b) => b.activities);
        const fights = { history: done.groundOps!.history, shipLegs: done.groundOps!.shipLegs, repairLegs: done.groundOps!.repairLegs ?? null, log: done.groundOps!.log ?? null };
        // SF-1: the claim hashes through withoutG2State (without the run counters a claim writes).
        const out = [hash(exp), hash(tl), hash(done.findings), hash(objectives), hash(fights), hash(done), hash(withoutG2State(claimed))];
        expect(out).toEqual(GOLDEN[`fresh:${label}:${cand}`]);
      });
    }
  }

  it("the six runs hold what they are pinned for: an affixed objective, an anomaly detour, fights and ship legs", () => {
    const runs = ["cand-0", "cand-1", "cand-2"].map((c) => freshRun(2, c));
    expect(runs[0].done.bodies.flatMap((b) => b.activities).some((a) => (a.affixes ?? []).length > 0)).toBe(true);
    expect(runs.some((r) => r.done.anomalyCharted)).toBe(true);
    expect(runs.every((r) => r.done.groundOps!.history.some((h) => h.outcome !== undefined))).toBe(true);
    expect(runs.some((r) => r.done.groundOps!.shipLegs.length > 0)).toBe(true);
  });

  for (const cand of ["cand-0", "cand-1", "cand-2"]) {
    it(`regular ${cand}: one call == 997 s chunks == 1 s steps == the event-boundary chain`, () => {
      const res = asPreRanksDispatch(startExpedition(crewed(2), "ship-1", 1, cand)); // FKR-1: flag off (see freshRun)
      expectParity(res.expedition!);
    });
  }

  it("shakedown cand-0: one call == 997 s chunks == 1 s steps == the event-boundary chain", () => {
    expectParity(asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(crewed(1), "ship-1", 1, "cand-0"))).expedition!); // FKR-1, SF-2: as before both
  });
});

// ===== 3. display: candidates and the telescope =====

// G2-1: freshState with no seed stores no homeworld and reads the provisional spot near Sol every save shared before
// G2-1, so golden 3 stays byte-identical. A save's own homeworld moves only the light-years: "G2-1 golden 3 with the
// homeworld" below asserts that field by field and pins the result.
// G2-2 (plan G2-2): a Tier I candidate as the console offered it before G2-2. G2-2 moved, by design, only: the id
// (`cand-<slot>` became `cand-1-<slot>`), the name (banked names retired, user G9), the new `region` field, and a
// FAMOUS system's distance (its real one from the homeworld; crewed(2) is the list after the first run, so slot 0
// is Wolf 359, user G10). This puts those back (the banked pick off the system stream's kept first draw, the drawn
// distance) and asserts nothing else moved, so golden 3 keeps its capture. Pure.
function asPreG2Candidate(c: ExpeditionCandidate, home: HomeworldPlacement): ExpeditionCandidate {
  const old = asPreG2CandidateFixture(c, home);
  const allowed = ["id", "systemId", "systemName", "region", ...(famousSystem(c.systemId) ? ["telescope.distanceLy"] : [])];
  const moved = changedPaths(old, c).filter((p) => !allowed.includes(p));
  expect(moved, c.id).toEqual([]);
  expect(c.region).toEqual({ tier: 1, enemyTerritory: false });
  return old as unknown as ExpeditionCandidate;
}

describe("G2-0 golden 3: candidates and the telescope views", () => {
  it("expeditionCandidates and each candidate's risk preview at telescope Levels 0, 1, 5 and 8", () => {
    const out: string[] = [];
    for (const level of [0, 1, 5, 8]) {
      const live = expeditionCandidates(atLevel(level, crewed(2)), "ship-1");
      expect(live.map((c) => c.id)).toEqual(["cand-1-0", "cand-1-1", "cand-1-2"]);
      expect(live[0].systemName).toBe("Wolf 359"); // G2-2: the list after the first run (user G10)
      const cands = live.map((c) => asPreG2Candidate(c, PROVISIONAL_HOMEWORLD));
      expect(cands.map((c) => c.id)).toEqual(["cand-0", "cand-1", "cand-2"]);
      out.push(`L${level}:${hash(cands)}`, ...cands.map((c) => hash(c)));
    }
    for (const c of expeditionCandidates(crewed(2), "ship-1")) out.push(`risk:${hash(expeditionRiskPreview(c.seed))}`);
    expect(out).toEqual(GOLDEN["display:candidates"]);
  });

  it("the launch view (demand, recommendation, forecast) of each candidate at Levels 5 and 8", () => {
    const out: string[] = [];
    for (const level of [5, 8]) {
      const state = atLevel(level, crewed(2));
      for (const c of expeditionCandidates(state, "ship-1")) {
        const view = expeditionLaunchView(state, "ship-1", c);
        expect(view.demand).not.toBeNull();
        out.push(hash(view));
      }
    }
    expect(out).toEqual(GOLDEN["display:launch"]);
  });

  it("the telescope reading at Levels 0 to 8, telescopeCardView and telescopeMapView at Levels 1 and 8", () => {
    const out: string[] = [];
    for (let level = 0; level <= 8; level++) out.push(hash(telescopeReadingAtLevel(level)));
    for (const level of [1, 8]) out.push(`card${level}:${hash(telescopeCardView(atLevel(level, freshState())))}`, `map${level}:${hash(telescopeMapView(level))}`);
    expect(out).toEqual(GOLDEN["display:telescope"]);
  });
});

// The leaf paths at which two plain JSON values differ ("" for the root). Pure.
function changedPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((k) => changedPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

// G2-1 (plan section 3 G2-1: "golden 3 changes ONLY in distances and ly numbers, asserted field by field"): the same
// views read with a stored homeworld (seed G2_1_HOMEWORLD_SEED) differ from golden 3 (no homeworld: the provisional
// spot) only in the light-years: each candidate's distance and the telescope's range, and the card's range texts.
// Pinned too.
const G2_1_HOMEWORLD_SEED = 0x6a09e667;
const homed = (s: GameState): GameState => ({ ...s, homeworld: { version: 1, seed: G2_1_HOMEWORLD_SEED } });
const G2_1_GOLDEN: Record<string, string[]> = {
  candidates: ["e196a0e6", "dfc8c538", "c7a61767", "7f6fe5b1"],
  card: ["51c2886e", "e64670ea"],
};

describe("G2-1 golden 3 with the homeworld: only the light-years move", () => {
  it("candidates: only telescope.distanceLy and telescope.rangeLy differ, at Levels 0, 1, 5 and 8", () => {
    const out: string[] = [];
    let moved = 0;
    for (const level of [0, 1, 5, 8]) {
      const state = homed(atLevel(level, crewed(2)));
      expect(state.homeworld).toBeDefined();
      const own = expeditionCandidates(state, "ship-1");
      const shared = expeditionCandidates(withoutG2State(state), "ship-1");
      own.forEach((c, i) => {
        const paths = changedPaths(shared[i], c);
        for (const p of paths) expect(["telescope.distanceLy", "telescope.rangeLy"], `L${level} ${c.id}`).toContain(p);
        if (paths.includes("telescope.distanceLy")) moved += 1;
      });
      // G2-2: hashed as offered before G2-2 (asPreG2Candidate, from this save's own homeworld).
      out.push(hash(own.map((c) => asPreG2Candidate(c, stateHomeworld(state)))));
    }
    expect(moved).toBeGreaterThan(0);
    expect(out).toEqual(G2_1_GOLDEN.candidates);
  });

  it("the launch view is unchanged by the homeworld (it reads the risk and task previews, never a distance)", () => {
    const out: string[] = [];
    for (const level of [5, 8]) {
      const state = homed(atLevel(level, crewed(2)));
      const shared = withoutG2State(state);
      const sharedCands = expeditionCandidates(shared, "ship-1");
      expeditionCandidates(state, "ship-1").forEach((c, i) => {
        const view = expeditionLaunchView(state, "ship-1", c);
        expect(view).toEqual(expeditionLaunchView(shared, "ship-1", sharedCands[i]));
        out.push(hash(view));
      });
    }
    expect(out).toEqual(GOLDEN["display:launch"]);
  });

  it("the card: only its light-year numbers and texts differ, at Levels 1 and 8; the map's default is unchanged", () => {
    const out: string[] = [];
    for (const level of [1, 8]) {
      const state = homed(atLevel(level, freshState()));
      const own = telescopeCardView(state);
      const paths = changedPaths(telescopeCardView(withoutG2State(state)), own);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) expect(p, `level ${level}`).toMatch(/(^|\.)(rangeText|rangeLy)$/);
      out.push(hash(own));
    }
    expect(out).toEqual(G2_1_GOLDEN.card);
  });
});

// ===== 4. reach: every hull x every mission and patrol =====

// ship-1 re-hulled to `hull` with the starting gear (plus the hull's combat Standard Issue), the captain at level 10
// and the stores full, so the dispatch gate fails only on what the hull and its reach decide. `boost` adds +300 Fuel
// Capacity to the installed FTL Drive (the fuel-to-reach.test.ts boostedFleet).
function reachState(hull: ShipTypeKey, boost: boolean): GameState {
  const base = freshState();
  const s = installMissingCombatBaselines({
    ...base,
    credits: new Decimal(1_000_000_000),
    captains: base.captains.map((c) => ({ ...c, level: 10 })),
    ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey: hull } : sh)),
  });
  if (!boost) return s;
  return {
    ...s,
    equipment: s.equipment.map((e) =>
      e.fittedToShipId === "ship-1" && e.slotType === "ftlDrive" ? { ...e, rolledStats: { ...e.rolledStats, fuelCapacity: (e.rolledStats.fuelCapacity ?? 0) + 300 } } : e,
    ),
  };
}

describe("G2-0 golden 4: reach and eligibility for every hull x every mission and patrol", () => {
  it("shipRangeLightYears, shipReachesRoundTrip, shipTripRangeLightYears and the dispatch gate", () => {
    const out: string[] = [];
    let refusedOnReach = 0;
    for (const boost of [false, true]) {
      for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
        const state = reachState(hull, boost);
        const ship = state.ships.find((sh) => sh.id === "ship-1")!;
        const rows: unknown[] = [shipRangeLightYears(state, ship)];
        for (const [key, m] of Object.entries(MISSIONS)) {
          const gate = canDispatch(state, ship.assignedCaptainId!, key as MissionKey);
          if (!gate.ok && gate.reason === "fuelCapacity") refusedOnReach += 1;
          rows.push([key, shipReachesRoundTrip(state, ship, m.transitOutTicks, m.transitBackTicks), shipTripRangeLightYears(state, ship, m.transitOutTicks + m.transitBackTicks), gate]);
        }
        for (const [key, p] of Object.entries(PATROLS)) {
          rows.push([key, shipReachesRoundTrip(state, ship, p.transitOutTicks, p.transitBackTicks), shipTripRangeLightYears(state, ship, p.transitOutTicks + p.transitBackTicks), canDispatchPatrol(state, ship.assignedCaptainId!, key as PatrolKey)]);
        }
        out.push(`${boost ? "boost" : "stock"}:${hull}:${hash(rows)}`);
      }
    }
    // The gate is exercised on both sides: some hull and mission pair is refused on reach.
    expect(refusedOnReach).toBeGreaterThan(0);
    expect(out).toEqual(GOLDEN.reach);
  });

  // G2-4 adds expedition gates (drive class, reach, frontier sensors): none may block a Tier I launch by accident.
  // The whole startExpedition result (the refusal, or the record and the state through withoutG2State) of a Tier I
  // candidate 0 launch from every hull, stock and boosted, with a slotted crew (1 Security + 1 Science) at T0.
  it("the Tier I startExpedition result for every hull, stock and with +300 Fuel Capacity", () => {
    const out: string[] = [];
    let launched = 0;
    for (const boost of [false, true]) {
      for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
        const state = withSlottedAwayTeams({
          ...reachState(hull, boost),
          gameTimeSeconds: T0,
          awayMembers: [plainAwayMember("member-1", "security", "ship-1"), plainAwayMember("member-11", "science", "ship-1")],
          nextAwayMemberId: 100,
        });
        // FKR-1, SF-2: see freshRun; G2-2: with the pre-G2 names restored and no region stamp (asPreG2NamesDispatch).
        const res = asPreG2NamesDispatch(asPreSafeFirstRunsDispatch(asPreRanksDispatch(startExpedition(state, "ship-1", 1, "cand-0"))));
        if (res.success) launched += 1;
        out.push(`${boost ? "boost" : "stock"}:${hull}:${hash({ ...res, next: withoutG2State(res.next), expedition: res.expedition ? withoutG2Run(res.expedition) : null })}`);
      }
    }
    // Every hull launches Tier I today (G2-4 must keep it so).
    expect(launched).toBe(20);
    expect(out).toEqual(GOLDEN["reach:expedition"]);
  });
});
