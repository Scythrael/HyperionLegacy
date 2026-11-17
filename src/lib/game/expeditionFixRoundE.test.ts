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
  type CandidateSystem,
} from "./expedition";
import { withAnswersOff } from "./fixRoundAnswersSwitch.fixture";
import { HELP_TOPICS } from "../helpTopics";
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
    // (Q3, 2026-11-17: a catalog-named system is now drawn from its name too; the Q3 block below.)
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

// ===== Fix pass (the FR-E review): the list restore and the notes it carries =====
//   R1  a list launch carries the candidate records it rolls off (Expedition.listNotes) and a recall that restores its
//       list puts them back, so a note on the list (its kept boundaries and anomaly) survives another ship's launch and
//       instant recall, and an ordinary held candidate does too; across a chain of restores, the notes on a list a
//       restore takes back wait for that list to be drawn again (HeldSystem.listSeed).
//   R2  a recall restores only the list its own launch drew: a run launched from a held candidate (no list drawn) never
//       rewinds the list, however its seed matches an older list.
describe("FR-E fix pass R1: the notes a list launch rolls off come back with its list", () => {
  const free = (s: GameState): GameState => ({ ...s, expeditions: [] });
  const SLOTS = ["cand-1-0", "cand-1-1", "cand-1-2"];
  // A run X launched from the list of a fresh save, and an instant mid-scan of its first body with an event paid. Pure.
  function cutFirstBody(): { base: GameState; state: GameState; exp: Expedition; cand: string; hit: { t: number; body: number; rolled: number } } {
    for (let seed = 1; seed < 400; seed++) {
      const base = crewed(0x1000 + seed);
      for (const cand of SLOTS) {
        const res = startExpedition(base, "ship-1", 1, cand);
        if (!res.success) continue;
        const hit = midBodyWithEvent(res.expedition!, true);
        if (hit) return { base, state: res.next, exp: res.expedition!, cand, hit };
      }
    }
    throw new Error("no run cuts its first body short with an event");
  }
  const repaidOn = (e: Expedition, rolled: number) => (e.scanEvents ?? []).filter((ev) => ev.bodyIndex === 0 && ev.step <= rolled);

  it("another ship's launch and instant recall keep the note: the relaunch pays nothing twice (the reviewer's loop)", () => {
    const { base, state, exp, cand, hit } = cutFirstBody();
    const s1 = recallExpedition(at(state, hit.t), exp.id);
    expect(s1.expeditionSeed).toBe(base.expeditionSeed);
    const [note] = heldSystems(s1);
    expect([note.inList, note.scanStepsRolled]).toEqual([true, hit.rolled]);
    // Ship Y launches another slot of the same list (drawing the next list), then is recalled at once.
    const y = startExpedition(free(s1), "ship-1", 1, SLOTS.find((c) => c !== cand)!);
    expect(y.success, y.reason).toBe(true);
    expect(heldSystems(y.next)).toEqual([]);
    expect(y.expedition!.listNotes).toEqual([note]);
    const s2 = recallExpedition(y.next, y.expedition!.id);
    expect(s2.expeditionSeed).toBe(base.expeditionSeed);
    expect(heldSystems(s2).find((h) => h.fromExpeditionId === exp.id)).toEqual(note);
    // X launched again from its slot: past the rolled boundaries, none of them paid again; again and again.
    let s = s2;
    for (let round = 0; round < 3; round++) {
      const x = startExpedition(free(s), "ship-1", 1, cand);
      expect(x.success, x.reason).toBe(true);
      expect(x.expedition!.scanStepCursor).toBe(hit.rolled);
      expect(repaidOn(advanceExpedition(x.expedition!, FINAL), hit.rolled)).toEqual([]);
      const back = recallExpedition(x.next, x.expedition!.id);
      expect(back.expeditionSeed).toBe(base.expeditionSeed);
      const yy = startExpedition(free(back), "ship-1", 1, SLOTS.find((c) => c !== cand)!);
      s = recallExpedition(yy.next, yy.expedition!.id);
    }
  });

  it("an ordinary held candidate on the console when the list launch rolled it off comes back with the restore", () => {
    const s0 = crewed();
    const a = startExpedition(s0, "ship-1", 1, "cand-1-0");
    const b = startExpedition(free(a.next), "ship-1", 1, "cand-1-0");
    // A's list is gone (B drew another): A's recall leaves an ordinary held candidate.
    const s1 = recallExpedition({ ...b.next, expeditions: [a.expedition!, b.expedition!] }, a.expedition!.id);
    const heldA = heldSystems(s1).find((h) => h.fromExpeditionId === a.expedition!.id)!;
    expect([heldA.kind, heldA.inList]).toEqual(["candidate", undefined]);
    expect(expeditionCandidates(s1, "ship-1", 1).map((c) => c.id)).toContain(heldA.id);
    // Y launches from the list on screen (rolling the held candidate off), then is recalled at once.
    const y = startExpedition({ ...s1, expeditions: [] }, "ship-1", 1, "cand-1-2");
    expect(y.success, y.reason).toBe(true);
    expect(heldSystems(y.next).some((h) => h.id === heldA.id)).toBe(false);
    const back = recallExpedition(y.next, y.expedition!.id);
    expect(back.expeditionSeed).toBe(s1.expeditionSeed);
    expect(heldSystems(back).find((h) => h.id === heldA.id)).toEqual(heldA);
    expect(expeditionCandidates(back, "ship-1", 1).map((c) => c.id)).toEqual(["cand-1-0", "cand-1-1", "cand-1-2", heldA.id]);
  });

  it("a chain of restores with several ships: every note waits for its own list", () => {
    const { base, state, exp, cand, hit } = cutFirstBody();
    const s1 = recallExpedition(at(state, hit.t), exp.id); // L1 restored, X's note on it
    // A launches another slot of L1 (draws L2, carries X's note); B launches from L2 (draws L3).
    const a = startExpedition(free(s1), "ship-1", 1, SLOTS.find((c) => c !== cand)!);
    const l2 = a.next.expeditionSeed;
    const b = startExpedition(free(a.next), "ship-1", 1, "cand-1-0");
    // B's route anomaly is charted (forced, as in M1), and B is recalled past it: its note on L2 keeps the anomaly.
    const bc: Expedition = { ...b.expedition!, anomalyResolved: true, anomalyCharted: true };
    const v = bc.voyage!;
    const tb = hit.t + Math.ceil(v.outboundSeconds * ANOMALY_CHECK_FRACTION + v.anomalySeconds + 60);
    const s2 = recallExpedition(at({ ...b.next, expeditions: [a.expedition!, bc] }, tb), bc.id);
    expect(s2.expeditionSeed).toBe(l2);
    const noteB = heldSystems(s2).find((h) => h.fromExpeditionId === bc.id)!;
    expect([noteB.inList, noteB.anomalyCharted]).toEqual([true, true]);
    // A recalled: L1 restored with X's note and A's; B's note waits (its list is not on screen, and it is no candidate).
    const s3 = recallExpedition(s2, a.expedition!.id);
    expect(s3.expeditionSeed).toBe(base.expeditionSeed);
    expect(s3.listRewinds).toBe(3);
    expect(heldSystems(s3).find((h) => h.fromExpeditionId === exp.id)?.scanStepsRolled).toBe(hit.rolled);
    expect(heldSystems(s3).find((h) => h.fromExpeditionId === bc.id)).toEqual(noteB);
    expect(expeditionCandidates(s3, "ship-1", 1).map((c) => c.id)).toEqual(SLOTS);
    // X again from its slot of L1 (draws L2 again): nothing re-paid; B's note is live on L2, and its slot meets the
    // anomaly already.
    const x = startExpedition(free(s3), "ship-1", 1, cand);
    expect(x.expedition!.scanStepCursor).toBe(hit.rolled);
    expect(x.next.expeditionSeed).toBe(l2);
    expect(heldSystems(x.next).map((h) => h.fromExpeditionId)).toEqual([bc.id]);
    const again = startExpedition(free(x.next), "ship-1", 1, "cand-1-0");
    expect(again.expedition!.seed).toBe(bc.seed);
    expect([again.expedition!.anomalyResolved, again.expedition!.anomalyMet]).toEqual([true, 1]);
    expect(heldSystems(again.next)).toEqual([]);
  });
});

describe("FR-E fix pass R2: a recall restores only the list its own launch drew", () => {
  it("a held launch whose seed matches an older list never rewinds the list (the reviewer's two-ship repro)", () => {
    const s0 = crewed();
    const a = startExpedition(s0, "ship-1", 1, "cand-1-0"); // from L1, draws L2
    const b = startExpedition({ ...a.next, expeditions: [] }, "ship-1", 1, "cand-1-1"); // from L2, draws L3
    const both = { ...b.next, expeditions: [a.expedition!, b.expedition!] };
    const s1 = recallExpedition(both, a.expedition!.id); // L3 not A's: A an ordinary held candidate
    expect(s1.expeditionSeed).toBe(b.next.expeditionSeed);
    const heldA = heldSystems(s1).find((h) => h.fromExpeditionId === a.expedition!.id)!;
    const s2 = recallExpedition(s1, b.expedition!.id); // L2 restored with B's note
    expect(s2.expeditionSeed).toBe(a.next.expeditionSeed);
    expect(s2.listRewinds).toBe(1);
    const noteB = heldSystems(s2).find((h) => h.fromExpeditionId === b.expedition!.id)!;
    expect(noteB.inList).toBe(true);
    // A launched again from its held id: no list drawn. Its recall leaves the list on screen alone.
    const a2 = startExpedition({ ...s2, expeditions: [] }, "ship-1", 1, heldA.id);
    expect(a2.success, a2.reason).toBe(true);
    expect(a2.next.expeditionSeed).toBe(s2.expeditionSeed);
    const s3 = recallExpedition(a2.next, a2.expedition!.id);
    expect(s3.expeditionSeed).toBe(s2.expeditionSeed);
    expect(s3.listRewinds).toBe(1);
    expect(heldSystems(s3).find((h) => h.fromExpeditionId === b.expedition!.id)).toEqual(noteB);
    const heldA2 = heldSystems(s3).find((h) => h.fromExpeditionId === a2.expedition!.id)!;
    expect([heldA2.kind, heldA2.inList]).toEqual(["candidate", undefined]);
    expect(tierCandidateSystems(s3, 1)).toEqual(tierCandidateSystems(s2, 1));
  });
});

// Fix round answers Q3 (user 2026-11-17, "Yes, same every visit"): a catalog-named system's bodies come from its catalog
// id (its tier's code and number), the way a real star's come from the star, so the same name is the same planets.
describe("Q3: a catalog-named system is the same system every visit", () => {
  // Two list slots (on different lists) that drew the same catalog name.
  function sameNamePair(): [GameState, CandidateSystem, GameState, CandidateSystem] {
    const seen = new Map<string, [GameState, CandidateSystem]>();
    for (let k = 0; k < 20_000; k++) {
      const s = crewed(0x9000 + k);
      for (const cand of tierCandidateSystems(s, 1)) {
        if (cand.famousId !== null) continue;
        const was = seen.get(cand.systemId);
        if (was !== undefined && was[1].seed !== cand.seed) return [was[0], was[1], s, cand];
        seen.set(cand.systemId, [s, cand]);
      }
    }
    throw new Error("no repeated catalog name");
  }

  it("two slots that drew the same name launch to the same bodies; their visits still roll their own", () => {
    const [sa, a, sb, b] = sameNamePair();
    expect(a.region.starId).toBe(a.systemId);
    const ra = startExpedition(sa, "ship-1", 1, a.id);
    const rb = startExpedition(sb, "ship-1", 1, b.id);
    expect(ra.success && rb.success).toBe(true);
    const shape = (e: Expedition) => JSON.stringify(e.bodies.map((x) => [x.planetType, x.scanTotal, x.hazard]));
    expect(shape(rb.expedition!)).toBe(shape(ra.expedition!));
    // The preview reads the same bodies the launch flies.
    expect(expeditionRiskPreview(a.seed, a.region).bodies).toEqual(ra.expedition!.bodies.map((x) => x.risk));
    // Q3 off: each slot keeps its own draw (the code before), and the candidate carries no identity.
    withAnswersOff(["catalogBodies"], () => {
      const offA = tierCandidateSystems(sa, 1).find((c) => c.id === a.id)!;
      expect(offA.region.starId).toBeUndefined();
      const xa = startExpedition(sa, "ship-1", 1, a.id).expedition!;
      const xb = startExpedition(sb, "ship-1", 1, b.id).expedition!;
      expect(shape(xa)).not.toBe(shape(xb));
    });
  });

  // Fix pass (user 2026-11-17, "Same place too"): the same distance, bearing and enemy-territory flag as well.
  it("two slots that drew the same name are the same place: distance, bearing, enemy territory, the run's stamp", () => {
    const place = (c: CandidateSystem) => [c.distanceLy, c.bearing, c.region.enemyTerritory];
    const [sa, a, sb, b] = sameNamePair();
    expect(place(b)).toEqual(place(a));
    const ra = startExpedition(sa, "ship-1", 1, a.id).expedition!;
    const rb = startExpedition(sb, "ship-1", 1, b.id).expedition!;
    expect(rb.region).toEqual(ra.region);
    expect(rb.voyage).toEqual(ra.voyage);
    // A tier with an enemy sector (a seeded homeworld's): every repeat of a name is at the same place, on either side.
    const byName = new Map<string, unknown[]>();
    let repeats = 0;
    let inside = 0;
    for (let k = 0; k < 3_000; k++) {
      for (const c of tierCandidateSystems({ ...crewed(0x9000 + k), homeworld: { version: 1, seed: 12345 } }, 4)) {
        if (c.famousId !== null) continue;
        const was = byName.get(c.systemId);
        if (was === undefined) byName.set(c.systemId, place(c));
        else {
          expect(place(c)).toEqual(was);
          repeats++;
          if (c.region.enemyTerritory) inside++;
        }
      }
    }
    expect(repeats).toBeGreaterThan(0);
    expect(inside).toBeGreaterThan(0);
    // Off (Q3), each slot drew its own place: the same name was somewhere else.
    withAnswersOff(["catalogBodies"], () => {
      const offA = tierCandidateSystems(sa, 1).find((c) => c.id === a.id)!;
      const offB = tierCandidateSystems(sb, 1).find((c) => c.id === b.id)!;
      expect(offA.systemId).toBe(offB.systemId);
      expect(place(offB)).not.toEqual(place(offA));
    });
  });

  it("the Expeditions Help says so", () => {
    const body = HELP_TOPICS.map((t) => t.body).join(" ");
    expect(body).toContain("the rest carry catalog names such as LB-0472. Every system, real star or catalog name, is the same system every visit: the same place (its distance and bearing from your homeworld, so whether it lies in enemy territory too) and the same planets (what each trip finds on them is its own).");
  });
});
