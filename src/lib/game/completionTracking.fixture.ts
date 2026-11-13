// Completion tracking (0.14.0, docs/plans/2026-11-13-completion-tracking-design.md): the shared fixtures of
// completionTrackingGoldens.test.ts and completionTracking.test.ts. TEST-ONLY (imported by *.test.ts files only).
//
// Real Ground Ops runs (the OC-F14 squad and systems, fieldRepairOrder.fixture.ts) read at the three moments the slice
// writes: a run CLAIMED home finished, a run RECALLED with a body charted (claimed home, its system held to Resume) and
// that Resume system ABANDONED. Plus one relic study whose identification completes an exceptional set inside an
// economy tick (the ledger's first event).

import { emptyMuseumV2, freshState, type Expedition, type GameState, type RelicVaultToken } from "./model";
import { advanceExpedition, claimExpedition, abandonHeldSystem, recallExpedition, heldSystems, startExpedition } from "./expedition";
import { exceptionalSetsOfTier } from "./relics";
import { identifyRelicV2 } from "./relicIdentify";
import { economyTick, startRelicStudy } from "./tick";
import { fnv, goldenJson, withoutRunCounts, SWEEP_END } from "./firstRunsGoldens.fixture";
import { RANK1, provingState } from "./safeFirstExpedition.fixture";

// Real training runs (Safe first runs: every objective finishes, safeFirstExpedition.fixture.ts) on the explorer, a
// full rank 1 crew, each of the fresh save's expedition seeds below and its first candidate.
export const CT_SEEDS = [0x1001, 0x2002, 0x3003, 0x4004, 0x5005] as const;
export const CT_FAR = SWEEP_END;
export const ctHash = (v: unknown): string => fnv(goldenJson(withoutRunCounts(v)));

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

// RECALLED 60 s after its first body was charted: [the recall, the claim once home, the abandon of the held system].
export function ctRecalled(seed: number): { recalled: GameState; claimed: GameState; abandoned: GameState } {
  const { next, exp } = ctDispatch(seed);
  const at = firstCharted(exp) + 60;
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
