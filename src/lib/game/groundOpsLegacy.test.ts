// Ground Operations GO-7b, STEP 1: legacy golden hashes, captured BEFORE the engine switch (plan section 0
// "Legacy-neutral"). A run WITHOUT `groundOps` (every run dispatched before GO-7b) must advance, resolve and claim
// byte-identically after the switch. Each run here is dispatched, then stripped of the flag
// (awayTeamTestFixtures.ts withoutGroundOps: before the switch there was nothing to strip), so the same inputs
// produce the same LEGACY record on both sides of the change. The captures include the GO-5 hazard resist curve
// (plan 4b, GO-5 review (a): the curve is the one named exception to legacy-neutral and predates these hashes).
//
//   plain   : a pre-Task-14 run (no encounterSteps / scanStepCursor / scanEvents): the oldest scan path.
//   pause   : a Task-14 encounter run whose lone Security member loses a scan battle (a loss pause), then
//             evacuates every task (Task 16: a downed member sits out the rest of the run).
//   wipes   : a Task-14 run with no scan loss whose squad is wiped in the activities phase (the in-resolution
//             retries, MAX_BATTLE_ATTEMPTS, and the 40% evacuation haul).
// Each is advanced in ONE call and in 997 s chunks (deep-equal), hashed at fixed checkpoints, then claimed.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState } from "./model";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { asPreG2NamesDispatch, asV67GroundState, plainAwayMember, withSlottedAwayTeams, withoutGroundOps, dispatchPastPropulsion } from "./awayTeamTestFixtures";
// SF-1: the claimed state hashes without the run counters (a claim writes them), absent before SF-1.
import { withoutRunCounts, goldenJson } from "./firstRunsGoldens.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const START = 1000;
const END = START + 2_000_000;
const CHECKPOINTS = [...Array.from({ length: 16 }, (_, i) => START + 1500 * (i + 1)), END];

function squad(security: number, science: number): AwayMember[] {
  const out: AwayMember[] = [];
  for (let i = 0; i < security; i += 1) out.push(plainAwayMember(`member-${i + 1}`, "security", "ship-1"));
  for (let i = 0; i < science; i += 1) out.push(plainAwayMember(`member-${i + 11}`, "science", "ship-1"));
  return out;
}

function dispatch(seed: number, members: AwayMember[]): { state: GameState; exp: Expedition } {
  const s = withSlottedAwayTeams({ ...freshState(), awayMembers: members, nextAwayMemberId: 100, expeditionSeed: seed, gameTimeSeconds: START });
  const res = asPreG2NamesDispatch(dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { state: res.next, exp: withoutGroundOps(res.expedition) };
}

// A pre-Task-14 record: the scan-encounter fields absent (an expedition launched before Task 14).
function preTask14(exp: Expedition): Expedition {
  const rest = { ...exp };
  delete rest.encounterSteps;
  delete rest.scanStepCursor;
  delete rest.scanEvents;
  return rest;
}

function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

interface Case {
  name: string;
  build: () => { state: GameState; exp: Expedition };
  check: (done: Expedition) => void;
}

const CASES: Case[] = [
  {
    name: "plain",
    build: () => {
      const d = dispatch(0x1238345, squad(3, 2));
      return { state: d.state, exp: preTask14(d.exp) };
    },
    check: (done) => {
      expect(done.encounterSteps).toBeUndefined();
      expect(done.scanEvents).toBeUndefined();
    },
  },
  {
    name: "pause",
    build: () => dispatch(0x1236456, squad(1, 1)),
    check: (done) => {
      expect((done.scanEvents ?? []).some((e) => e.outcome === "loss" && (e.pauseSeconds ?? 0) > 0)).toBe(true);
      expect(done.findings.some((f) => f.evacuated)).toBe(true);
    },
  },
  {
    name: "wipes",
    build: () => dispatch(0x1259124, squad(1, 1)),
    check: (done) => {
      expect((done.scanEvents ?? []).some((e) => e.outcome === "loss")).toBe(false);
      expect(done.bodies.some((b) => b.activities.some((a) => (a.downedMemberIds ?? []).length > 0))).toBe(true);
      expect(done.findings.some((f) => f.evacuated)).toBe(true);
    },
  },
];

// Captured from the code BEFORE GO-7b's engine edit: [checkpoint hashes..., claim hash].
const GOLDEN: Record<string, string[]> = {
  plain: ["51a6b54a", "57bbe196", "c235ae9c", "38999dd4", "b25f35f9", "326f7d57", "86496a51", "45a67548", "c43f17e5", "722785cd", "8d760705", "2f85a5ab", "2f85a5ab", "2f85a5ab", "2f85a5ab", "2f85a5ab", "2f85a5ab", "13aaf50b"],
  pause: ["b168856d", "544e2a74", "8081cad5", "e0cdae45", "b80a82f6", "424800a7", "8e082be3", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "c0a617ff", "6e11d267"],
  wipes: ["b960f9fe", "b960f9fe", "b960f9fe", "6192307b", "85a08d3e", "2a7018a9", "aa28c3ca", "1cfeccbb", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "18d0f86e", "a9156c90"],
};

describe("legacy runs (no groundOps) stay byte-identical across the GO-7b switch (golden)", () => {
  for (const c of CASES) {
    it(`${c.name}: one call == 997 s chunks, checkpoints and claim match the pre-switch capture`, { timeout: 120_000 }, () => {
      const { state, exp } = c.build();
      expect("groundOps" in exp).toBe(false);
      const hashes = CHECKPOINTS.map((t) => fnv(goldenJson(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, END);
      expect(done.phase).toBe("complete");
      c.check(done);
      expect(chunked(exp, START, END, 997)).toEqual(done);
      const claimed = claimExpedition({ ...state, expeditions: [done] }, done.id);
      expect(claimed.success).toBe(true);
      // Squads SQ-1 (v68): the claim hash reads the state as v67 held it (asV67GroundState strips exactly the
      // team kinds, the added empty pair and the telescope seed), so the capture still proves nothing else moved.
      hashes.push(fnv(goldenJson(withoutRunCounts(asV67GroundState(claimed.next)))));
      expect(hashes).toEqual(GOLDEN[c.name]);
    });
  }
});
