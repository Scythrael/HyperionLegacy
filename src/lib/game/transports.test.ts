// Crew 0.14.0 (Phase 2): tests for the DORMANT crew transport influx (transports.ts).
// Covers: the game-time window accumulator (elapsed windows since lastWindow, offline backlog, never
// negative), batch determinism + headcount, folding a batch into a pool, and delivering a whole
// backlog. Nothing here touches the tick (the accumulator is a pure function of gameTimeSeconds).

import { describe, it, expect } from "vitest";
import type { CrewBucket } from "./model";
import {
  TRANSPORT_WINDOW_SECONDS,
  TRANSPORT_BATCH_SIZE,
  transportWindowIndex,
  crewTransportsDue,
  transportBatch,
  foldTransportBatch,
  deliverDueTransports,
  takesWelcomeBatch,
  welcomeTransportCount,
  welcomeTransportMarker,
  TRANSPORT_WELCOME_AFTER_WINDOWS,
  TRANSPORT_WELCOME_PENDING,
  TRANSPORT_WELCOME_SWITCH,
} from "./transports";
import { OFFLINE_CAP_SECONDS_BASE } from "./offlineCap";
import { totalCrew } from "./crew";

describe("transport accumulator (game-time windows)", () => {
  it("transportWindowIndex floors game time into windows", () => {
    expect(transportWindowIndex(0)).toBe(0);
    expect(transportWindowIndex(TRANSPORT_WINDOW_SECONDS - 1)).toBe(0);
    expect(transportWindowIndex(TRANSPORT_WINDOW_SECONDS)).toBe(1);
    expect(transportWindowIndex(TRANSPORT_WINDOW_SECONDS * 3 + 5)).toBe(3);
    expect(transportWindowIndex(-100)).toBe(0); // clamps negative time
  });

  it("crewTransportsDue counts the windows elapsed since lastWindow", () => {
    // 3.5 windows of game time, last delivery at window 0 => 3 batches owed.
    const t = TRANSPORT_WINDOW_SECONDS * 3 + TRANSPORT_WINDOW_SECONDS / 2;
    expect(crewTransportsDue(0, t)).toBe(3);
    // Caught up already (lastWindow == current) => nothing owed.
    expect(crewTransportsDue(3, t)).toBe(0);
    // A long offline span delivers the whole backlog.
    expect(crewTransportsDue(0, TRANSPORT_WINDOW_SECONDS * 50)).toBe(50);
    // lastWindow ahead of the current index is never negative.
    expect(crewTransportsDue(10, TRANSPORT_WINDOW_SECONDS * 2)).toBe(0);
  });
});

describe("transportBatch", () => {
  it("is deterministic in (seed, windowIndex, count)", () => {
    expect(transportBatch(123, 4, TRANSPORT_BATCH_SIZE)).toEqual(transportBatch(123, 4, TRANSPORT_BATCH_SIZE));
  });

  it("delivers exactly `count` crew (headcount across the coalesced buckets)", () => {
    const batch = transportBatch(123, 4, TRANSPORT_BATCH_SIZE);
    expect(totalCrew(batch)).toBe(TRANSPORT_BATCH_SIZE);
  });

  it("different windows deliver different crew (the influx is not the same batch every window)", () => {
    const a = JSON.stringify(transportBatch(123, 1, TRANSPORT_BATCH_SIZE));
    const b = JSON.stringify(transportBatch(123, 2, TRANSPORT_BATCH_SIZE));
    expect(a).not.toBe(b);
  });

  it("coalesces duplicate signatures (bucket count, not one row per head)", () => {
    const batch = transportBatch(7, 0, 100);
    // With 100 crew over a finite signature space, buckets must merge (< 100 rows).
    expect(batch.length).toBeLessThan(100);
    expect(totalCrew(batch)).toBe(100);
  });

  it("a zero-or-negative count yields an empty batch", () => {
    expect(transportBatch(7, 0, 0)).toEqual([]);
    expect(transportBatch(7, 0, -3)).toEqual([]);
  });
});

describe("folding batches into a pool", () => {
  it("foldTransportBatch merges a batch into a pool without mutating inputs", () => {
    const pool: CrewBucket[] = [];
    const batch = transportBatch(50, 0, TRANSPORT_BATCH_SIZE);
    const next = foldTransportBatch(pool, batch);
    expect(totalCrew(next)).toBe(TRANSPORT_BATCH_SIZE);
    expect(pool).toEqual([]); // input untouched
  });

  it("folding the SAME batch twice doubles the headcount and merges buckets", () => {
    const batch = transportBatch(50, 0, TRANSPORT_BATCH_SIZE);
    const once = foldTransportBatch([], batch);
    const twice = foldTransportBatch(once, batch);
    expect(totalCrew(twice)).toBe(TRANSPORT_BATCH_SIZE * 2);
    // Same signatures, so the bucket COUNT does not grow on the second fold.
    expect(twice.length).toBe(once.length);
  });

  it("deliverDueTransports folds the whole backlog and advances the window marker", () => {
    const gameTime = TRANSPORT_WINDOW_SECONDS * 4; // windows 1..4 owed from lastWindow 0
    const { pool, lastWindow } = deliverDueTransports(999, [], 0, gameTime);
    expect(lastWindow).toBe(4);
    expect(totalCrew(pool)).toBe(TRANSPORT_BATCH_SIZE * 4);
  });

  it("deliverDueTransports is a no-op when caught up, and never rewinds the marker", () => {
    const gameTime = TRANSPORT_WINDOW_SECONDS * 2;
    const caughtUp = deliverDueTransports(999, [], 2, gameTime);
    expect(caughtUp.pool).toEqual([]);
    expect(caughtUp.lastWindow).toBe(2);
    // lastWindow ahead of the current index stays put.
    const ahead = deliverDueTransports(999, [], 5, gameTime);
    expect(ahead.lastWindow).toBe(5);
  });

  it("delivering a backlog in one step matches delivering window by window", () => {
    const seed = 246;
    const gameTime = TRANSPORT_WINDOW_SECONDS * 3;
    const oneStep = deliverDueTransports(seed, [], 0, gameTime);
    // Step it one window at a time and compare.
    let stepped = deliverDueTransports(seed, [], 0, TRANSPORT_WINDOW_SECONDS);
    stepped = deliverDueTransports(seed, stepped.pool, stepped.lastWindow, TRANSPORT_WINDOW_SECONDS * 2);
    stepped = deliverDueTransports(seed, stepped.pool, stepped.lastWindow, TRANSPORT_WINDOW_SECONDS * 3);
    expect(totalCrew(stepped.pool)).toBe(totalCrew(oneStep.pool));
    expect(stepped.lastWindow).toBe(oneStep.lastWindow);
  });
});

// Staging freeze (2026-11-14): deliverDueTransports builds one list instead of folding the pool per window. The reference
// below is the per-window fold it replaced, verbatim; the two must agree group for group, count for count, in order.
function perWindowFoldReference(seed: number, pool: CrewBucket[], lastWindow: number, gameTimeSeconds: number, batchSize: number) {
  const current = transportWindowIndex(gameTimeSeconds);
  let next = pool.map((b) => ({ ...b }));
  for (let w = lastWindow + 1; w <= current; w += 1) {
    next = foldTransportBatch(next, transportBatch(seed, w, batchSize));
  }
  return { pool: next, lastWindow: Math.max(lastWindow, current) };
}

describe("deliverDueTransports: one pass, the same result as the per-window fold", () => {
  it("agrees on seeded pools (with repeated signatures in the pool), batch sizes and spans", () => {
    for (const seed of [1, 7, 999, 0x5eed, 0xdeadbeef]) {
      // A pool seeded from earlier transports, with one group duplicated (only the FIRST of a signature takes the merge).
      const prior = perWindowFoldReference(seed ^ 0x55, [], 0, TRANSPORT_WINDOW_SECONDS * 40, TRANSPORT_BATCH_SIZE).pool;
      const pool = [...prior, { ...prior[0], count: 3 }, ...prior.slice(1, 4).map((b) => ({ ...b, count: 1 }))];
      for (const batchSize of [TRANSPORT_BATCH_SIZE, TRANSPORT_BATCH_SIZE + 3]) {
        for (const [last, windows] of [[0, 0], [0, 1], [3, 50], [-1, 7], [-20, 300], [5, 0]] as const) {
          const t = TRANSPORT_WINDOW_SECONDS * (Math.max(0, last) + windows) + 11;
          const fast = deliverDueTransports(seed, pool, last, t, batchSize);
          expect(fast).toEqual(perWindowFoldReference(seed, pool, last, t, batchSize));
        }
      }
      // Never mutates its input pool.
      const before = JSON.stringify(pool);
      deliverDueTransports(seed, pool, 0, TRANSPORT_WINDOW_SECONDS * 30);
      expect(JSON.stringify(pool)).toBe(before);
    }
  });
});

describe("welcome batch (user 2026-11-13, \"A welcome batch to fill the fleet\")", () => {
  it("takes the welcome only for a pending marker or one further behind than a catch-up reaches", () => {
    const capWindows = Math.floor(OFFLINE_CAP_SECONDS_BASE / TRANSPORT_WINDOW_SECONDS);
    expect(TRANSPORT_WELCOME_AFTER_WINDOWS).toBe(capWindows + 1);
    expect(takesWelcomeBatch(TRANSPORT_WELCOME_PENDING, 0)).toBe(true);
    expect(takesWelcomeBatch(TRANSPORT_WELCOME_PENDING, 86400 * 365)).toBe(true);
    // A four-day absence (a whole offline cap) straddling a window edge is an ordinary backlog.
    expect(takesWelcomeBatch(0, (capWindows + 1) * TRANSPORT_WINDOW_SECONDS + 5)).toBe(false);
    expect(takesWelcomeBatch(0, (capWindows + 2) * TRANSPORT_WINDOW_SECONDS)).toBe(true);
    expect(takesWelcomeBatch(10, 11 * TRANSPORT_WINDOW_SECONDS)).toBe(false);
    const was = TRANSPORT_WELCOME_SWITCH.live;
    TRANSPORT_WELCOME_SWITCH.live = false;
    try {
      expect(takesWelcomeBatch(TRANSPORT_WELCOME_PENDING, 86400 * 365)).toBe(false);
    } finally {
      TRANSPORT_WELCOME_SWITCH.live = was;
    }
  });

  it("counts the transports that fill the open berths once, after the crew on hand", () => {
    expect(welcomeTransportCount(0, 0, 12)).toBe(0);
    expect(welcomeTransportCount(12, 0, 12)).toBe(1);
    expect(welcomeTransportCount(13, 0, 12)).toBe(2);
    expect(welcomeTransportCount(6250, 0, 12)).toBe(521);
    expect(welcomeTransportCount(100, 90, 12)).toBe(1);
    expect(welcomeTransportCount(100, 500, 12)).toBe(0);
    expect(welcomeTransportCount(24, 0, 15)).toBe(2);
  });

  it("the welcome marker delivers exactly the most recent windows and lands the marker at now", () => {
    const t = TRANSPORT_WINDOW_SECONDS * 17520 + 7;
    const marker = welcomeTransportMarker(t, 521);
    expect(marker).toBe(17520 - 521);
    const { pool, lastWindow } = deliverDueTransports(42, [], marker, t);
    expect(lastWindow).toBe(17520);
    expect(totalCrew(pool)).toBe(521 * TRANSPORT_BATCH_SIZE);
    // A young save: the welcome reaches below window 0 and still delivers exactly that many transports.
    const young = deliverDueTransports(42, [], welcomeTransportMarker(100, 5), 100);
    expect(young.lastWindow).toBe(0);
    expect(totalCrew(young.pool)).toBe(5 * TRANSPORT_BATCH_SIZE);
  });
});
