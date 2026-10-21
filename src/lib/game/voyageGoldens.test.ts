// Expedition Tiers G2-3 goldens first (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-3): hashes
// captured on the code BEFORE the voyage engine (on top of 1c512fc). G2-3 stamps `Expedition.voyage` on NEW runs only;
// a run in flight at the update has none and must keep its old timing exactly. Two stored records
// (voyageGoldens.fixture.ts) the G2-0 goldens do not cover:
//
//   training : the Safe first runs TRAINING RUN (difficulty.firstRun: the tutorial transit constant), Tier I.
//   tier4    : a regular run that carries the G2-2 region stamp at Tier IV (the deeper bodies, the tier haul).
//
// Each is hashed along its own timeline (the timeline itself, transit midpoint, arrival, mid-scan, window end, the
// finished run, the claim) and through the speed seam's time skip (processSpeed.ts applyTimeSkip). Plus offline ==
// live parity (one call == 997 s chunks == 1 s steps around arrival == the event-boundary chain), and the same
// dispatch made today through `withoutVoyage` equals the stored record (G2-3: "a dispatch with `voyage` deleted").

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { advanceExpedition, advanceExpeditionSeed, claimExpedition, startExpedition } from "./expedition";
import { applyTimeSkip } from "./processSpeed";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, plainAwayMember, withoutCurve } from "./awayTeamTestFixtures";
import { PRE_G2_3_STORED_RUNS } from "./voyageGoldens.fixture";
import { withV1Museum } from "./firstRunsGoldens.fixture";

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
const FINAL = T0 + 3_000_000;
const PHASES = ["transit", "scanning", "activities", "return", "complete"];
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// The run without G2-3's stamp (`voyage`). Pure: a shallow copy.
export function withoutVoyage(exp: Expedition): Expedition {
  const rest = { ...exp } as Record<string, unknown>;
  delete rest.voyage;
  return rest as unknown as Expedition;
}

// ship-1 with two Ground teams of six rank 10 members (3 Security + 3 Science each), the clock at T0.
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

const orion = (s: GameState): GameState => installMissingCombatBaselines({ ...s, ships: s.ships.map((x) => (x.id === "ship-1" ? { ...x, typeKey: "orion" as const } : x)) });

type Name = "training" | "tier4";
const CASES: Record<Name, { crew: () => GameState; candidate: string }> = {
  training: { crew: () => orion(crewed(1)), candidate: "cand-1-0" },
  tier4: { crew: () => asExpeditionVeteran(crewed(2)), candidate: "cand-4-0" },
};

const stored = (name: Name): Expedition => structuredClone(PRE_G2_3_STORED_RUNS[name]) as Expedition;

// The state a save held with `exp` in flight (the dispatch's `next`: the run listed, the number and seed advanced).
function held(crew: GameState, exp: Expedition): GameState {
  return { ...crew, nextExpeditionId: crew.nextExpeditionId + 1, expeditionSeed: advanceExpeditionSeed(crew.expeditionSeed), expeditions: [exp] };
}

function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

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

function eventTimes(done: Expedition, tl: [string, number][], to: number): number[] {
  const times = new Set<number>(tl.map(([, t]) => t));
  const ops = done.groundOps;
  for (const r of ops?.history ?? []) for (const t of [r.startedAt, r.endedAt]) times.add(t);
  for (const l of ops?.log ?? []) times.add(l.at);
  for (const leg of ops?.shipLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
  for (const leg of ops?.repairLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.repairedAt, leg.endsAt]) times.add(t);
  return [...times].filter((t) => Number.isFinite(t) && t > T0 + 1 && t + 1 < to).sort((a, b) => a - b);
}

export function expectVoyageParity(exp: Expedition): void {
  const frozen = structuredClone(exp);
  const tl = timeline(exp);
  const end = anchorOf(tl, "complete") + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, exp.phaseAnchorSeconds, end, 997)).toEqual(one);
  const arrival = anchorOf(tl, "scanning");
  const from = Math.floor(arrival) - 300;
  expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  let e = exp;
  for (const t of eventTimes(one, tl, end)) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
  expect(advanceExpedition(e, end)).toEqual(one);
  expect(exp).toEqual(frozen);
}

// Layout: [timeline, transit midpoint, arrival, mid-scan, window end, finished run, claim, time skip].
const GOLDEN: Record<Name, string[]> = {
  training: ["e952ec7c", "d34817", "167fe5ae", "ad241803", "668ee9b3", "a0e508f8", "ddf4c918", "cb99aa71"],
  tier4: ["52f842de", "a5902d22", "edc3b73d", "8c5b4b0f", "de3e0890", "77f479ed", "6ff37e5e", "2895747a"],
};

describe("G2-3 goldens first: pre-voyage in-flight runs keep their timing", () => {
  for (const name of ["training", "tier4"] as const) {
    it(`${name}: the stored record's timeline, checkpoints, claim and time skip match the pre-voyage capture`, () => {
      const exp = stored(name);
      expect("voyage" in exp).toBe(false);
      if (name === "training") expect(exp.difficulty?.firstRun).toBe(true);
      else expect(exp.region?.tier).toBe(4);
      const state = held(CASES[name].crew(), exp);
      const tl = timeline(exp);
      const arrival = anchorOf(tl, "scanning");
      const done = advanceExpedition(exp, FINAL);
      const windowEnd = done.groundOps!.endedAt!;
      expect(windowEnd).toBe(anchorOf(tl, "return"));
      const points = [Math.floor((T0 + arrival) / 2), arrival, Math.floor((arrival + anchorOf(tl, "activities")) / 2), windowEnd];
      const claim = claimExpedition({ ...state, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
      expect(claim.success).toBe(true);
      const skip = applyTimeSkip({ ...state, gameTimeSeconds: T0 + 1_000 }, { kind: "expedition", id: exp.id });
      expect(skip.applied).toBe(true);
      const out = [hash(tl), ...points.map((t) => hash(advanceExpedition(exp, t))), hash(done), hash(withV1Museum(claim.next)), hash(skip.next.expeditions)]; // R2-1: the museum in its v1 form, as captured
      expect(out).toEqual(GOLDEN[name]);
    });

    it(`${name}: one call == 997 s chunks == 1 s steps == the event-boundary chain`, () => {
      expectVoyageParity(stored(name));
    });

    it(`${name}: the same dispatch made today, without its voyage, is the stored record`, () => {
      const res = startExpedition(CASES[name].crew(), "ship-1", 1, CASES[name].candidate);
      expect(res.success).toBe(true);
      // Safe first runs SF-3: the ordinary run's curve stamp postdates the capture too (withoutCurve).
      expect(withoutCurve(withoutVoyage(res.expedition!))).toEqual(stored(name));
    });
  }
});
