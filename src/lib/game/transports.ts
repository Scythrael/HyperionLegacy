// Crew 0.14.0 (Phase 2): the crew TRANSPORT influx (pure, DORMANT).
//
// Transports are the "gentle gacha influx" that trickles fresh complement crew into the unassigned
// pool over time. This module is the PURE logic for that: a deterministic per-window batch of newly
// generated crew (transportBatch) and a game-time-window ACCUMULATOR (crewTransportsDue) that says
// how many transport windows have elapsed since the last delivery, plus small pure helpers to fold a
// batch (or a whole backlog) into a pool bucket list.
//
// GAME-TIME, NEVER WALL-CLOCK: like the salvage idle watch (tick.ts refreshSalvageIdleWatch) and the
// officer roster refresh, delivery is keyed on GameState.gameTimeSeconds, NOT Date.now(). Modeling a
// window as floor(gameTimeSeconds / TRANSPORT_WINDOW_SECONDS) makes the influx a pure function of
// elapsed game time, so an offline span naturally delivers its backlog and live == offline agrees.
//
// DORMANT: nothing here is wired into the tick. The later "crew goes live" wiring phase will call
// crewTransportsDue each tick, deliver transportBatch per elapsed window into state.crewPool, and
// advance state.lastTransportWindow (the field already exists from Phase 0). ALL numbers are
// FIRST-PASS + TUNABLE. See docs/plans/2026-09-22-crew-0.14.0-plan.md ("Engine seams" 4, Phase 2).

import type { CrewBucket, CrewSignature } from "./model";
import { generateComplementCrew } from "./crewGeneration";
import { addToBucketList, coalesceBuckets } from "./crew";

// The transport window length, in gameTimeSeconds. Models "a transport arrives roughly every half
// hour" as a game-time window so delivery is a pure function of the window index. FIRST-PASS ~1800s;
// TUNABLE.
export const TRANSPORT_WINDOW_SECONDS = 1800;

// How many crew ride one transport. A gentle trickle, not a flood. FIRST-PASS + TUNABLE.
export const TRANSPORT_BATCH_SIZE = 12;

// The transport window index for a given game time: floor(gameTimeSeconds / TRANSPORT_WINDOW_SECONDS).
// A new batch is due whenever this steps. Pure.
export function transportWindowIndex(gameTimeSeconds: number): number {
  return Math.floor(Math.max(0, gameTimeSeconds) / TRANSPORT_WINDOW_SECONDS);
}

// How many transport windows have elapsed since `lastWindow` at the current game time: the count of
// batches owed (0 when no new window has passed; the full backlog after a long offline span). Never
// negative, so a `lastWindow` somehow ahead of the current index yields 0. Pure. Mirrors the salvage
// idle watch's game-time delta approach. The later wiring phase advances lastTransportWindow by this.
export function crewTransportsDue(lastWindow: number, gameTimeSeconds: number): number {
  return Math.max(0, transportWindowIndex(gameTimeSeconds) - lastWindow);
}

// One transport's worth of freshly generated crew, as a COALESCED bucket list: `count` crew rolled
// deterministically from (seed, windowIndex) via generateComplementCrew, then histogrammed so
// identical signatures merge into one bucket. Deterministic in (seed, windowIndex, count): the same
// three inputs always yield the same batch, which is what makes the offline backlog reproducible.
// Each crew's per-row seed mixes the window index in so different windows deliver different crew. A
// count of zero or less yields an empty batch. Pure.
export function transportBatch(seed: number, windowIndex: number, count: number): CrewBucket[] {
  if (count <= 0) return [];
  // Decorrelate the per-window stream from `seed` so each window draws an independent set of crew,
  // while staying a pure function of (seed, windowIndex).
  const windowSeed = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ ((windowIndex + 1) >>> 0)) >>> 0;
  const crew: CrewSignature[] = [];
  for (let i = 0; i < count; i += 1) {
    crew.push(generateComplementCrew(windowSeed, i));
  }
  // Histogram into buckets (each fresh crew is a count-1 signature; coalesce merges duplicates).
  return coalesceBuckets(crew.map((sig) => ({ ...sig, count: 1 })));
}

// Fold ONE batch of crew into a pool bucket list, merging same-signature buckets. Returns a NEW list;
// never mutates either input. This is the "fold a batch into a pool" helper the plan asks for. Pure.
export function foldTransportBatch(pool: CrewBucket[], batch: CrewBucket[]): CrewBucket[] {
  let next = pool.map((b) => ({ ...b }));
  for (const b of batch) {
    next = addToBucketList(next, b, b.count);
  }
  return next;
}

// Deliver the WHOLE backlog of due transports into a pool in one pure step: for every window elapsed
// since `lastWindow` up to the current game time, generate that window's batch and fold it in, then
// report the advanced window marker. Returns { pool, lastWindow } so a later tick-wiring phase can
// write both back onto GameState (crewPool + lastTransportWindow) without a per-tick catch-up loop.
// Same-input determinism holds end to end. Never mutates the input pool. Pure.
export function deliverDueTransports(
  seed: number,
  pool: CrewBucket[],
  lastWindow: number,
  gameTimeSeconds: number,
): { pool: CrewBucket[]; lastWindow: number } {
  const current = transportWindowIndex(gameTimeSeconds);
  let next = pool.map((b) => ({ ...b }));
  // Deliver each owed window's batch, in order, from lastWindow+1 up to the current window.
  for (let w = lastWindow + 1; w <= current; w += 1) {
    next = foldTransportBatch(next, transportBatch(seed, w, TRANSPORT_BATCH_SIZE));
  }
  // Never move the marker backward (a lastWindow ahead of current leaves it untouched).
  return { pool: next, lastWindow: Math.max(lastWindow, current) };
}
