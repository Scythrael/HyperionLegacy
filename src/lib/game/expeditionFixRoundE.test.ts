// Fix round FR-E (0.14.0, docs/qa/2026-11-13-fable-sweep-ledger.md lane 3 and the USER ANSWERS of 2026-11-13/14):
//   I1  a recall and a resume never pay a scan boundary twice (the cut-short body's rolled boundaries are kept);
//   M1  a charted anomaly's haul never repeats on a held candidate;
//   I3  "Recalled launch keeps the list (Recommended)": a recall that sends the system back to the candidates restores
//       the list it was launched from (no free reroll);
//   I2  "Same system every visit (Recommended)": a real star's bodies are seeded from the star;
//   q3  "Roll needs a real objective (Recommended)": the planet roll needs one objective finished on that planet, not
//       skipped (skips still count toward the %).

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import {
  ANOMALY_CHECK_FRACTION,
  advanceExpedition,
  candidateSlotSeed,
  claimExpedition,
  expeditionCandidates,
  expeditionRiskPreview,
  heldSystems,
  recallExpedition,
  startExpedition,
  systemTaskPreview,
  tierCandidateSystems,
} from "./expedition";
import { famousSystemsOfTier } from "./starCatalog";
import { installMissingCombatBaselines } from "./tick";
import { asExpeditionVeteran, plainAwayMember } from "./awayTeamTestFixtures";
import { bodiesToRoll, type CompletionTally } from "./completion";

const T0 = 100_000;
const FINAL = T0 + 3_000_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

function crewed(expeditionSeed?: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    ...(expeditionSeed !== undefined ? { expeditionSeed } : {}),
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, typeKey: "orion" as const, groundTeams: teams })),
  };
  return asExpeditionVeteran(installMissingCombatBaselines(s));
}

const at = (state: GameState, t: number): GameState => ({ ...state, gameTimeSeconds: t });
const only = (state: GameState): Expedition => state.expeditions[0];

// Recall `exp` at `t`, fly it home and claim it. Pure.
function recallHome(state: GameState, exp: Expedition, t: number): { state: GameState; home: Expedition } {
  const s1 = recallExpedition(at(state, t), exp.id);
  const home = advanceExpedition(only(s1), FINAL);
  const s2 = claimExpedition({ ...s1, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, exp.id).next;
  // (The Shipyard repairs any hull damage the scan events left before the next launch.)
  const repaired = { ...s2, ships: s2.ships.map(({ damaged: _d, repairDamage: _r, ...sh }) => sh as GameState["ships"][number]), activeProcesses: [] };
  return { state: repaired, home };
}

// The first instant a run is mid-scan on its first unscanned body with at least one boundary of that body rolled AND an
// event recorded on it (a supply cache or a ship event), or null. Pure.
function midBodyWithEvent(exp: Expedition, first: boolean): { t: number; body: number; rolled: number } | null {
  const steps = exp.encounterSteps ?? 1;
  const perBody = Math.max(0, steps - 1);
  for (let t = exp.phaseAnchorSeconds + 60; t < FINAL; t += 60) {
    const e = advanceExpedition(exp, t);
    if (e.phase === "return" || e.phase === "complete") return null;
    if (e.phase !== "scanning" && e.phase !== "activities") continue;
    const body = e.bodies.findIndex((b) => !b.scanned);
    if (body < 0) return null;
    const rolled = (e.scanStepCursor ?? 0) - body * perBody;
    if (rolled <= 0 || (body === 0) !== first) continue;
    if ((e.scanEvents ?? []).some((ev) => ev.bodyIndex === body && ev.step <= rolled)) return { t, body, rolled };
  }
  return null;
}

describe("FR-E I1: a recall and a resume never pay a scan boundary twice", () => {
  it.each([true, false])("the cut-short body's rolled boundaries are kept and skipped on the next launch, twice over (first body: %s)", (first) => {
    let found: { state: GameState; exp: Expedition; at: { t: number; body: number; rolled: number } } | null = null;
    for (let seed = 1; seed < 400 && found === null; seed++) {
      const base = crewed(0x1000 + seed);
      for (const cand of ["cand-1-0", "cand-1-1", "cand-1-2"]) {
        const res = startExpedition(base, "ship-1", 1, cand);
        if (!res.success) continue;
        const hit = midBodyWithEvent(res.expedition!, first);
        if (hit) {
          found = { state: res.next, exp: res.expedition!, at: hit };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { state, exp, at: hit } = found!;
    const firstTrip = advanceExpedition(exp, hit.t);
    const paidOnFirst = (firstTrip.scanEvents ?? []).filter((ev) => ev.bodyIndex === hit.body && ev.step <= hit.rolled);
    expect(paidOnFirst.length).toBeGreaterThan(0);
    const { state: s2 } = recallHome(state, exp, hit.t);
    const [held] = heldSystems(s2);
    // The first body cut short leaves a candidate (a note on its restored list's slot); a later one a Resume system.
    expect(held.kind).toBe(hit.body === 0 ? "candidate" : "resume");
    expect(held.scanStepsRolled).toBe(hit.rolled);
    const idOf = (s: GameState, h: (typeof held)): string =>
      h.inList ? tierCandidateSystems(s, h.region.tier).find((c) => c.seed === h.seed)!.id : h.id;
    // Launched again, then recalled again before arriving (the transit), then launched once more: the count survives.
    const r1 = startExpedition(s2, "ship-1", 1, idOf(s2, held));
    expect(r1.success, r1.reason).toBe(true);
    if (held.kind === "resume") expect(r1.expedition!.resume!.scanStepsRolled).toBe(hit.rolled);
    else expect(r1.expedition!.scanStepCursor).toBe(hit.rolled);
    const { state: s3 } = recallHome(r1.next, r1.expedition!, r1.expedition!.phaseAnchorSeconds + 60);
    const [held2] = heldSystems(s3);
    expect(held2.kind).toBe(held.kind);
    expect(held2.scanStepsRolled).toBe(hit.rolled);
    const r2 = startExpedition(s3, "ship-1", 1, idOf(s3, held2));
    expect(r2.success, r2.reason).toBe(true);
    const done = advanceExpedition(r2.expedition!, FINAL);
    expect(done.phase).toBe("complete");
    // Nothing on the cut-short body's rolled boundaries is rolled again; the later boundaries are rolled as usual.
    const repaid = (done.scanEvents ?? []).filter((ev) => ev.bodyIndex === hit.body && ev.step <= hit.rolled);
    expect(repaid).toEqual([]);
    // Parity: one call == 997 s chunks.
    let e = r2.expedition!;
    for (let t = e.phaseAnchorSeconds + 997; t < FINAL; t += 997) e = advanceExpedition(e, t);
    expect(advanceExpedition(e, FINAL)).toEqual(done);
  });
});

describe("FR-E M1: a charted anomaly's haul never repeats on a held candidate", () => {
  it("a run recalled after its anomaly was charted: the relaunch meets no anomaly again", () => {
    // Chart the anomaly by hand (the test forces the latch the midpoint roll would set), then recall past the midpoint.
    const s0 = crewed();
    const first = startExpedition(s0, "ship-1", 1, "cand-1-0");
    expect(first.success).toBe(true);
    const exp = first.expedition!;
    const charted: Expedition = { ...exp, anomalyResolved: true, anomalyCharted: true };
    const v = exp.voyage!;
    const t = T0 + Math.ceil(v.outboundSeconds * ANOMALY_CHECK_FRACTION + v.anomalySeconds + 60);
    // No list was drawn since, so the recall restores the list (I3) and the system's note rides its slot (inList).
    const { state: s2 } = recallHome({ ...first.next, expeditions: [charted] }, charted, t);
    const held = heldSystems(s2).find((h) => h.fromExpeditionId === exp.id)!;
    expect(held.kind).toBe("candidate");
    expect(held.anomalyCharted).toBe(true);
    // Relaunched: from its slot (the list restored) or its held id, the anomaly is already met.
    const id = held.inList ? "cand-1-0" : held.id;
    const again = startExpedition(s2, "ship-1", 1, id);
    expect(again.success, again.reason).toBe(true);
    expect(again.expedition!.seed).toBe(exp.seed);
    expect(again.expedition!.anomalyResolved).toBe(true);
    const done = advanceExpedition(again.expedition!, FINAL);
    expect(done.anomalyCharted).toBe(false);
    expect(done.findings.some((f) => f.source === "anomaly")).toBe(false);
  });
});

describe("FR-E I3: a recalled launch keeps the list (no free reroll)", () => {
  it("an instant recall restores the list it was launched from, every tier deep-equal", () => {
    const s0 = crewed();
    const before = [1, 2, 3, 4, 5, 6, 7].map((t) => tierCandidateSystems(s0, t as 1));
    const launched = startExpedition(s0, "ship-1", 1, "cand-1-1");
    expect(launched.success).toBe(true);
    expect(launched.next.expeditionSeed).not.toBe(s0.expeditionSeed);
    const recalled = recallExpedition(launched.next, launched.expedition!.id);
    expect(recalled.expeditionSeed).toBe(s0.expeditionSeed);
    expect([1, 2, 3, 4, 5, 6, 7].map((t) => tierCandidateSystems(recalled, t as 1))).toEqual(before);
    // The system is back in its own slot, offered once (no extra held candidate on the list).
    const ids = expeditionCandidates(recalled, "ship-1", 1).map((c) => c.id);
    expect(ids).toEqual(["cand-1-0", "cand-1-1", "cand-1-2"]);
    // Claimed home: the next launch from the list draws the same fresh list the first launch drew.
    const home = advanceExpedition(only(recalled), FINAL);
    const s2 = claimExpedition({ ...recalled, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, home.id).next;
    expect(tierCandidateSystems(s2, 1)).toEqual(before[0]);
    const relaunch = startExpedition(s2, "ship-1", 1, "cand-1-1");
    expect(relaunch.success, relaunch.reason).toBe(true);
    expect(relaunch.expedition!.seed).toBe(launched.expedition!.seed);
    expect(relaunch.next.expeditionSeed).toBe(launched.next.expeditionSeed);
    expect(heldSystems(relaunch.next)).toEqual([]);
  });

  it("the Wolf 359 list is kept too (the first list after the first run)", () => {
    const base = { ...crewed(), nextExpeditionId: 1 };
    const s0 = { ...base, runCounts: { ...base.runCounts!, expedition: { ...base.runCounts!.expedition, veteran: false } } };
    const first = startExpedition(s0, "ship-1", 1, "cand-1-0");
    const afterFirst = tierCandidateSystems(first.next, 1);
    const second = startExpedition({ ...first.next, expeditions: [] }, "ship-1", 1, "cand-1-2");
    expect(second.success, second.reason).toBe(true);
    const back = recallExpedition(second.next, second.expedition!.id);
    expect(tierCandidateSystems(back, 1)).toEqual(afterFirst);
  });

  it("when another list was drawn since, the recalled system is an ordinary held candidate as before", () => {
    const s0 = crewed();
    const a = startExpedition(s0, "ship-1", 1, "cand-1-0");
    // A second ship launches from the new list: the list the first run came from is gone.
    // (Launched again from the new list with the same ship, its first run set aside, then both are out.)
    const b = startExpedition({ ...a.next, expeditions: [] }, "ship-1", 1, "cand-1-0");
    expect(b.success, b.reason).toBe(true);
    const s1 = { ...b.next, expeditions: [a.expedition!] };
    const back = recallExpedition(s1, a.expedition!.id);
    expect(back.expeditionSeed).toBe(s1.expeditionSeed);
    expect(heldSystems(back).map((h) => [h.kind, h.inList])).toEqual([["candidate", undefined]]);
  });
});

describe("FR-E I2: a real star is the same system every visit", () => {
  it("every candidate slot that rolls the same real star has the same bodies", () => {
    const byStar = new Map<string, string>();
    let pairs = 0;
    for (let k = 0; k < 4000; k++) {
      const s = { ...crewed(0x5000 + k) };
      for (const cand of tierCandidateSystems(s, 1)) {
        if (cand.famousId === null) continue;
        const list = expeditionCandidates(s, "ship-1", 1).find((c) => c.id === cand.id)!;
        const res = startExpedition(s, "ship-1", 1, cand.id);
        expect(res.success, res.reason).toBe(true);
        const shape = JSON.stringify(res.expedition!.bodies.map((b) => [b.planetType, b.scanTotal, b.hazard]));
        // The preview reads the same bodies the launch flies.
        expect(list.foreknowledge.bodyCount === null || list.foreknowledge.bodyCount === res.expedition!.bodies.length).toBe(true);
        expect(expeditionRiskPreview(cand.seed, cand.region).bodies).toEqual(res.expedition!.bodies.map((b) => b.risk));
        expect(systemTaskPreview(cand.seed, res.expedition!.scanParams, cand.region).bodies).toEqual(res.expedition!.bodies.map((b) => b.risk));
        const was = byStar.get(cand.famousId);
        if (was !== undefined) {
          pairs += 1;
          expect(shape, cand.famousId).toBe(was);
        } else byStar.set(cand.famousId, shape);
      }
      if (pairs >= 6) break;
    }
    expect(pairs).toBeGreaterThanOrEqual(6);
    expect(famousSystemsOfTier(1).length).toBeGreaterThan(0);
    // A catalog system keeps its slot's draw (the bodies differ by slot as before).
    expect(candidateSlotSeed(1, 1, 0)).not.toBe(candidateSlotSeed(1, 1, 1));
  });
});

describe("FR-E q3: the planet roll needs a real objective finished there", () => {
  const tally = (bodies: CompletionTally["bodies"]): CompletionTally => ({ bodies, nebula: null });
  it("skips alone, or no objectives, pay no roll; one done objective (with skips) pays", () => {
    expect(bodiesToRoll(tally([{ scanned: true, objectives: 2, done: 0, skipped: 2 }]), undefined)).toEqual([]);
    expect(bodiesToRoll(tally([{ scanned: true, objectives: 0, done: 0, skipped: 0 }]), undefined)).toEqual([]);
    expect(bodiesToRoll(tally([{ scanned: true, objectives: 3, done: 1, skipped: 2 }]), undefined)).toEqual([0]);
    expect(bodiesToRoll(tally([{ scanned: true, objectives: 1, done: 1, skipped: 0 }]), { bodiesRolled: [0] })).toEqual([]);
  });
});
