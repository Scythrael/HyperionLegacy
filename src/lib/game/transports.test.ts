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
} from "./transports";
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
