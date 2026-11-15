// Crew 0.14.0 (Phase 2): the crew TRANSPORT influx (pure; crewOverlay.ts resolveCrew delivers it once per tick).
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
// Wired: crewOverlay.ts resolveCrew calls crewTransportsDue each tick, delivers the due batches into
// state.crewPool and advances state.lastTransportWindow. ALL numbers are FIRST-PASS + TUNABLE. See
// docs/plans/2026-09-22-crew-0.14.0-plan.md ("Engine seams" 4, Phase 2).

import type { CrewBucket, CrewSignature, GameState } from "./model";
import { HOMEWORLD_TALENTS } from "./model";
import { generateComplementCrew } from "./crewGeneration";
import { addToBucketList, coalesceBuckets, signatureKey } from "./crew";
import { OFFLINE_CAP_SECONDS_BASE } from "./offlineCap";

// The transport window length, in gameTimeSeconds. Models "a transport arrives roughly every half
// hour" as a game-time window so delivery is a pure function of the window index. FIRST-PASS ~1800s;
// TUNABLE.
export const TRANSPORT_WINDOW_SECONDS = 1800;

// How many crew ride one transport. A gentle trickle, not a flood. FIRST-PASS + TUNABLE.
export const TRANSPORT_BATCH_SIZE = 12;

// WR-6 (0.14.0, OC-B3, user 2026-10-15 "Citizenry helps crew recruitment"): the crew one transport carries for this
// fleet: the base batch plus every owned transportCrewBonus Homeworld talent (Civic Charter). A batch of N + k rolls
// the same first N crew as a batch of N (each crew's roll is keyed by its index), so the bonus ADDS crew and never
// rerolls the others. Exactly TRANSPORT_BATCH_SIZE without one. Pure.
export function transportBatchSize(state: Pick<GameState, "unlockedHomeworldTalents">): number {
  let extra = 0;
  for (const key of state.unlockedHomeworldTalents) {
    const e = HOMEWORLD_TALENTS[key]?.effect;
    if (e && e.type === "transportCrewBonus") extra += e.crew;
  }
  return TRANSPORT_BATCH_SIZE + Math.max(0, Math.floor(extra));
}

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
//
// STAGING FREEZE FIX (2026-11-14; a pure optimization, no outcome change: transports.test.ts pins it against the
// per-window fold): this used to fold each window's batch with foldTransportBatch, which copies the WHOLE pool for every
// crew group of every window, so a long backlog cost windows x pool size (a year-old save: 17,520 windows, minutes on a
// phone). It now builds the one result list in a single pass: the pool copied once, then every batch group merged into
// the FIRST pool group of its signature (addToBucketList's rule) through a signature index, or appended in order. The
// same groups, counts and order as the per-window fold, in time linear in the crew delivered.
export function deliverDueTransports(
  seed: number,
  pool: CrewBucket[],
  lastWindow: number,
  gameTimeSeconds: number,
  // WR-6: the crew per transport (transportBatchSize); the base batch by default.
  batchSize: number = TRANSPORT_BATCH_SIZE,
): { pool: CrewBucket[]; lastWindow: number } {
  const current = transportWindowIndex(gameTimeSeconds);
  const next = pool.map((b) => ({ ...b }));
  const firstIndex = new Map<string, number>();
  for (let i = 0; i < next.length; i += 1) {
    const key = signatureKey(next[i]);
    if (!firstIndex.has(key)) firstIndex.set(key, i);
  }
  // Deliver each owed window's batch, in order, from lastWindow+1 up to the current window.
  for (let w = lastWindow + 1; w <= current; w += 1) {
    for (const b of transportBatch(seed, w, batchSize)) {
      if (b.count <= 0) continue;
      const key = signatureKey(b);
      const at = firstIndex.get(key);
      if (at !== undefined) {
        next[at] = { ...next[at], count: next[at].count + b.count };
      } else {
        firstIndex.set(key, next.length);
        next.push({ ...b });
      }
    }
  }
  // Never move the marker backward (a lastWindow ahead of current leaves it untouched).
  return { pool: next, lastWindow: Math.max(lastWindow, current) };
}

// WELCOME BATCH (staging freeze, user 2026-11-13: "A welcome batch to fill the fleet (Recommended)": enough transports
// to fill every open berth once, then normal transports from the update on).
//
// A save from before the crew layer (v54 and older) has no transport window on record, and its game clock may have run
// for months, so delivering "every window since the save began" floods it with hundreds of thousands of crew. The same
// holds for any save whose window marker fell further behind than one offline catch-up can ever reach. Such a save
// instead receives the MOST RECENT `welcomeTransportCount` windows' transports (deterministic, the ordinary batches of
// those windows) and its marker moves to now. A marker below zero (TRANSPORT_WELCOME_PENDING, what the v54 -> v55
// migration records) always takes the welcome; an ordinary marker takes it only when it is behind by more than the
// windows the offline cap can span (OFFLINE_CAP_SECONDS_BASE, plus one for a span that straddles a window edge), which a
// live or offline catch-up never is (both step the economy one second at a time).
export const TRANSPORT_WELCOME_PENDING = -1;
export const TRANSPORT_WELCOME_AFTER_WINDOWS = Math.floor(OFFLINE_CAP_SECONDS_BASE / TRANSPORT_WINDOW_SECONDS) + 1;

// TEST-ONLY switch (the HOMEWORLD_RESERVE_SWITCH precedent): OFF delivers the whole backlog as before the welcome batch,
// so a golden file that builds its crew pool from a long backlog keeps proving its own slice. Always live in the game.
export const TRANSPORT_WELCOME_SWITCH = { live: true };

// True when this marker takes the welcome batch instead of its backlog. Pure.
export function takesWelcomeBatch(lastWindow: number, gameTimeSeconds: number): boolean {
  if (!TRANSPORT_WELCOME_SWITCH.live) return false;
  return lastWindow < 0 || crewTransportsDue(lastWindow, gameTimeSeconds) > TRANSPORT_WELCOME_AFTER_WINDOWS;
}

// How many transports fill `openBerths` once, after the crew already waiting (`crewOnHand`, the pool and the reserve)
// take their share: ceil(the rest / the crew per transport), never negative. Pure.
export function welcomeTransportCount(openBerths: number, crewOnHand: number, batchSize: number): number {
  const need = Math.max(0, Math.floor(openBerths) - Math.max(0, Math.floor(crewOnHand)));
  if (need === 0 || batchSize <= 0) return 0;
  return Math.ceil(need / batchSize);
}

// The marker the welcome batch delivers from: the current window less the welcome transports, so deliverDueTransports
// delivers exactly the most recent `transports` windows and leaves the marker at now. Pure.
export function welcomeTransportMarker(gameTimeSeconds: number, transports: number): number {
  return transportWindowIndex(gameTimeSeconds) - Math.max(0, Math.floor(transports));
}
