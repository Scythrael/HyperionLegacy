// Completion tracking (0.14.0, docs/plans/2026-11-13-completion-tracking-design.md): the shared fixtures of
// completionTrackingGoldens.test.ts and completionTracking.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Real Ground Ops runs (the OC-F14 squad and systems, fieldRepairOrder.fixture.ts) read at the three moments the slice
// writes: a run CLAIMED home finished, a run RECALLED with a body charted (claimed home, its system held to Resume) and
// that Resume system ABANDONED. Plus one relic study whose identification completes an exceptional set inside an
// economy tick (the ledger's first event).

import { emptyMuseumV2, freshState, type Expedition, type GameState, type HeldSystem, type RelicVaultToken } from "./model";
import { advanceExpedition, claimExpedition, abandonHeldSystem, editGroundOps, recallExpedition, heldSystems, startExpedition } from "./expedition";
import { exceptionalSetsOfTier } from "./relics";
import { identifyRelicV2 } from "./relicIdentify";
import { runCompletion } from "./completion";
import { economyTick, startRelicStudy } from "./tick";
import { fnv, goldenJson, withoutRunCountsKeepingCompletion, SWEEP_END } from "./firstRunsGoldens.fixture";
import { RANK1, provingState } from "./safeFirstExpedition.fixture";

// Real training runs (Safe first runs: every objective finishes, safeFirstExpedition.fixture.ts) on the explorer, a
// full rank 1 crew, each of the fresh save's expedition seeds below and its first candidate.
export const CT_SEEDS = [0x1001, 0x2002, 0x3003, 0x4004, 0x5005] as const;
export const CT_FAR = SWEEP_END;
export const ctHash = (v: unknown): string => fnv(goldenJson(withoutRunCountsKeepingCompletion(v)));

export function ctDispatch(seed: number): { next: GameState; exp: Expedition } {
  const res = startExpedition(provingState("orion", RANK1, seed), "ship-1", 1, "cand-0");
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

// The run dispatched and advanced home finished, on the state it was dispatched from (the claim's input).
export function ctFinished(seed: number): { state: GameState; exp: Expedition } {
  const { next, exp } = ctDispatch(seed);
  const done = advanceExpedition(exp, CT_FAR);
  if (done.phase !== "complete") throw new Error(`run ${seed.toString(16)} did not finish`);
  return { state: { ...next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, exp: done };
}

// The state after the finished run's claim.
export function ctClaimed(seed: number): GameState {
  const { state, exp } = ctFinished(seed);
  const r = claimExpedition(state, exp.id);
  if (!r.success) throw new Error(`claim refused: ${r.reason}`);
  return r.next;
}

// The first instant (600 s steps) the run's first body is charted.
function firstCharted(exp: Expedition): number {
  let t = exp.phaseAnchorSeconds;
  for (;;) {
    t += 600;
    if (t > exp.phaseAnchorSeconds + 1e7) throw new Error("no body was ever charted");
    if (advanceExpedition(exp, t).bodies[0].scanned) return t;
  }
}

// The first instant (600 s steps) the run's first body is 100% (scanned, every objective done) while the run still works.
function firstBodyComplete(exp: Expedition): number {
  let t = exp.phaseAnchorSeconds;
  for (;;) {
    t += 600;
    if (t > exp.phaseAnchorSeconds + 1e7) throw new Error("no body was ever completed");
    const e = advanceExpedition(exp, t);
    if (e.phase === "complete" || e.phase === "return") throw new Error("the run finished before a body completed alone");
    if (runCompletion(e).bodyLines[0].complete) return t;
  }
}

// RECALLED 60 s after its first body was charted (`when` "charted"), or 60 s after its first body reached 100% (`when`
// "bodyDone", the planet roll's abandon fixture): [the recall, the claim once home, the abandon of the held system].
export function ctRecalled(seed: number, when: "charted" | "bodyDone" = "charted"): { recalled: GameState; claimed: GameState; abandoned: GameState } {
  const { next, exp } = ctDispatch(seed);
  const at = (when === "charted" ? firstCharted(exp) : firstBodyComplete(exp)) + 60;
  const recalled = recallExpedition({ ...next, gameTimeSeconds: at, expeditions: [advanceExpedition(exp, at)] }, exp.id);
  const home = advanceExpedition(recalled.expeditions[0], CT_FAR);
  if (home.phase !== "complete") throw new Error("the recalled run did not come home");
  const claim = claimExpedition({ ...recalled, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, home.id);
  if (!claim.success) throw new Error(`claim refused: ${claim.reason}`);
  const held = heldSystems(claim.next).find((h) => h.kind === "resume");
  if (!held) throw new Error("the recall held no Resume system");
  const abandoned = abandonHeldSystem({ ...claim.next, gameTimeSeconds: claim.next.gameTimeSeconds + 100 }, held.id);
  return { recalled, claimed: claim.next, abandoned };
}

// RESUMED: the recalled run's Resume system dispatched again (the same ship and captain), flown home finished and
// claimed. [the resumed claim's state, the resumed run as claimed].
export function ctResumed(seed: number, when: "charted" | "bodyDone" = "charted"): { claimed: GameState; exp: Expedition } {
  const r = ctRecalled(seed, when);
  const held = heldSystems(r.claimed).find((h) => h.kind === "resume");
  if (!held) throw new Error("the recall held no Resume system");
  const res = startExpedition(r.claimed, "ship-1", 1, held.id);
  if (!res.success || !res.expedition) throw new Error(`resume refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, CT_FAR);
  if (done.phase !== "complete") throw new Error(`resumed run ${seed.toString(16)} did not finish`);
  const claim = claimExpedition({ ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
  if (!claim.success) throw new Error(`claim refused: ${claim.reason}`);
  return { claimed: claim.next, exp: done };
}

// SKIPPED, then RECALLED (the review's Important 1): at the first instant (300 s steps) a charted body has objectives
// and none of them is done, every objective of that body is SKIPPED (the body reaches 100% by skips alone), then
// the run is recalled 60 s later.
// [the recall, the claim once home (its system held to Resume), the abandon of the held system, the resumed run's
// claim (the held system dispatched again and finished), the held system as the claim left it].
export function ctSkipRecalled(seed: number): { recalled: GameState; claimed: GameState; abandoned: GameState; resumed: GameState; held: HeldSystem } {
  const { next, exp } = ctDispatch(seed);
  let t = exp.phaseAnchorSeconds;
  let e = exp;
  const queuedBody = (x: Expedition): number => x.bodies.findIndex((b) => b.scanned && b.activities.length > 0 && b.activities.every((a) => !a.done && a.status !== "skipped"));
  while (queuedBody(e) < 0) {
    t += 300;
    if (e.phase === "return" || e.phase === "complete") throw new Error("no body ever had its objectives all open");
    e = advanceExpedition(exp, t);
  }
  const k = queuedBody(e);
  let s: GameState = { ...next, gameTimeSeconds: t, expeditions: [e] };
  for (const a of e.bodies[k].activities) s = editGroundOps(s, exp.id, { kind: "skip", taskId: a.id });
  const skipped = s.expeditions[0];
  if (!skipped.bodies[k].activities.every((a) => a.status === "skipped")) throw new Error("a skip was refused");
  const at = t + 60;
  const recalled = recallExpedition({ ...s, gameTimeSeconds: at, expeditions: [advanceExpedition(skipped, at)] }, exp.id);
  const home = advanceExpedition(recalled.expeditions[0], CT_FAR);
  if (home.phase !== "complete") throw new Error("the recalled run did not come home");
  const claim = claimExpedition({ ...recalled, gameTimeSeconds: home.phaseAnchorSeconds, expeditions: [home] }, home.id);
  if (!claim.success) throw new Error(`claim refused: ${claim.reason}`);
  const held = heldSystems(claim.next).find((h) => h.kind === "resume");
  if (!held) throw new Error("the recall held no Resume system");
  const abandoned = abandonHeldSystem({ ...claim.next, gameTimeSeconds: claim.next.gameTimeSeconds + 100 }, held.id);
  const res = startExpedition(claim.next, "ship-1", 1, held.id);
  if (!res.success || !res.expedition) throw new Error(`resume refused: ${res.reason}`);
  const done = advanceExpedition(res.expedition, CT_FAR);
  if (done.phase !== "complete") throw new Error("the resumed run did not finish");
  const resumedClaim = claimExpedition({ ...res.next, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done.id);
  if (!resumedClaim.success) throw new Error(`claim refused: ${resumedClaim.reason}`);
  return { recalled, claimed: claim.next, abandoned, resumed: resumedClaim.next, held };
}

// ===== The relic set completed inside an economy tick =====

// The token the study identifies (a Tier I radiant blank with no site) and the study index that rolls an exceptional
// piece of a Tier I set (found once by search, pinned in completionTracking.test.ts).
export const CT_SET_TOKEN: RelicVaultToken = { id: "ct-set-blank", tier: "radiant", quality: 0, regionTier: 1 };

// The first study index from 1 whose identification, with every OTHER piece of its set already held, is an exceptional
// piece of a Tier I set. Pure (a bounded search over keyed rolls).
export function ctSetStudyIndex(): { index: number; setId: string; pieceId: string } {
  const sets = exceptionalSetsOfTier(1);
  for (let index = 1; index < 200_000; index++) {
    for (const set of sets) {
      for (const piece of set.pieces) {
        const held = Object.fromEntries(set.pieces.filter((p) => p.id !== piece.id).map((p) => [p.id, 1]));
        const out = identifyRelicV2(freshState().relicSeed, { exceptional: held }, CT_SET_TOKEN, index);
        if (out.kind === "exceptional" && out.setId === set.id && out.pieceId === piece.id) return { index, setId: set.id, pieceId: piece.id };
      }
    }
  }
  throw new Error("no study index completes a set");
}

// The state with the study started: the set's other pieces held, the blank under study at `index`.
export function ctSetStudyState(index: number, setId: string, pieceId: string): GameState {
  const set = exceptionalSetsOfTier(1).find((s) => s.id === setId)!;
  const exceptional = Object.fromEntries(set.pieces.filter((p) => p.id !== pieceId).map((p) => [p.id, 1]));
  const base: GameState = {
    ...freshState(),
    facilities: { ...freshState().facilities, research: { level: 1 } },
    museumV2: { ...emptyMuseumV2(), exceptional },
    relicVault: [{ ...CT_SET_TOKEN }],
    nextRelicStudyIndex: index,
  };
  const r = startRelicStudy(base, CT_SET_TOKEN.id);
  if (!r.started) throw new Error(`study refused: ${r.reason}`);
  return r.next;
}

// The state after the study completes, in ONE economy tick of `span` seconds.
export function ctSetCompleted(index: number, setId: string, pieceId: string, span: number): GameState {
  return economyTick(ctSetStudyState(index, setId, pieceId), span, () => 0);
}
