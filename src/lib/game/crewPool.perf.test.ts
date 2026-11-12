// crewPool.perf.test.ts (CP-21 close-out): the crew pool's per-tick cost once every passive berth is full.
//
// Excluded from the default suite (vite.config.ts) and run alone, serially, by `npm run test:perf`, like
// src/lib/secret/catchUp.perf.test.ts: under a full parallel run the other workers load the machine and the timings
// measure that load. The deterministic half (the guard changes no outcome) lives in crewPoolGuard.test.ts.
//
// The case: a fleet whose passive berths are all full keeps every transport (12 crew per 1,800 s) in the pool. After 35
// days the pool holds about 20,000 crew. Before the CP-21 guard, every 1 s tick copied the pool and re-scanned it rank by
// rank for every passive ship, full or not, and an offline catch-up runs one economyTick per second of the absence.
import { describe, expect, it } from "vitest";
import { report } from "../secret/testReport";
import { freshState, type GameState, type ShipInstance, type ShipTypeKey } from "./model";
import { resolveCrew } from "./crewOverlay";
import { totalCrew } from "./crew";
import { tick } from "./tick";
import { TRANSPORT_WINDOW_SECONDS } from "./transports";
import { homeworldReserveCount } from "./homeworldReserve";
import { withHomeworldReserveOff } from "./homeworldReserveSwitch.fixture";

const DAY = 86400;
// The fleet below seats 2,920 crew, about 5 days of transports; 35 more days leave about 20,000 in the pool.
const POOL_DAYS = 40;
// A catch-up span: 6 hours of 1 s steps, crossing 12 transport windows.
const SPAN_SECONDS = 6 * 3600;
// The per-step budget (ms): one economyTick on this fleet with the pool idle. Comparable to the secret catch-up's
// bound (5,000 ms for its whole 30-day job); a 6-hour catch-up here stays under 0.25 ms a step, 5.4 s in all.
const PER_STEP_BUDGET_MS = 0.25;

const FLEET: readonly ShipTypeKey[] = ["carrier", "eir", "orion", "aurora", "battleship", "destroyer", "prospectorMiner"];

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A fleet of passive ships, every berth filled, with 35 days of transports left over in the pool (delivered and filled by the real
// resolveCrew: one call delivers the 1,920 windows' backlog and auto-crews the fleet from it).
export function fullFleetWithDeepPool(): GameState {
  const base = freshState();
  const extra: ShipInstance[] = FLEET.map((typeKey, i) => ({ id: `ship-${i + 2}`, typeKey, assignedCaptainId: null }));
  const start: GameState = {
    ...base,
    ships: [...base.ships, ...extra],
    nextShipId: base.ships.length + extra.length + 1,
    gameTimeSeconds: POOL_DAYS * DAY + 7,
    lastTransportWindow: 0,
  };
  return resolveCrew(start);
}

describe("crew pool stays cheap once every berth is full", () => {
  // The CP-21 case as it was measured: the homeworld reserve OFF, so the surplus stays in the pool (the guard's own path).
  it(`a 35-day pool (about 20,000 crew) through a ${SPAN_SECONDS / 3600}-hour catch-up (reserve off)`, () => {
    withHomeworldReserveOff(() => deepPoolCatchUp());
  }, 600000);

  // Homeworld reserve (user 2026-11-12): the same fleet with the reserve live. The first call moves the 35 days of surplus
  // to the reserve, every later window moves its own transport, and the pool stays empty; the reserve must cost no more
  // than the pool did (the guard's memo holds the reserve's reference, so an idle reserve is never re-scanned).
  it(`a 35-day homeworld reserve (about 20,000 crew) through a ${SPAN_SECONDS / 3600}-hour catch-up`, () => {
    const s = fullFleetWithDeepPool();
    const reserved = homeworldReserveCount(s);
    expect(reserved).toBeGreaterThan(19500);
    expect(s.crewPool).toEqual([]);
    tick(60, s, lcg(0x21));
    const t0 = performance.now();
    const out = tick(SPAN_SECONDS, s, lcg(0x21));
    const ms = performance.now() - t0;
    const perStep = ms / SPAN_SECONDS;
    report(
      `[perf] homeworld reserve ${reserved} crew, ${s.ships.length} ships, ${SPAN_SECONDS} steps: ${ms.toFixed(0)} ms, ${(perStep * 1000).toFixed(1)} us per step`,
    );
    expect(out.gameTimeSeconds).toBe(s.gameTimeSeconds + SPAN_SECONDS);
    // Every transport went on to the reserve (the fleet was full) and the pool stayed empty.
    expect(homeworldReserveCount(out)).toBe(reserved + 12 * (SPAN_SECONDS / TRANSPORT_WINDOW_SECONDS));
    expect(out.crewPool).toEqual([]);
    expect(perStep).toBeLessThan(PER_STEP_BUDGET_MS);
  }, 600000);
});

function deepPoolCatchUp(): void {
  const s = fullFleetWithDeepPool();
  const pooled = totalCrew(s.crewPool);
  expect(pooled).toBeGreaterThan(19500);
  expect(s.lastTransportWindow).toBe(Math.floor((POOL_DAYS * DAY + 7) / TRANSPORT_WINDOW_SECONDS));

  // Warm up (JIT, caches) on a short span, then time the catch-up.
  tick(60, s, lcg(0x21));
  const t0 = performance.now();
  const out = tick(SPAN_SECONDS, s, lcg(0x21));
  const ms = performance.now() - t0;
  const perStep = ms / SPAN_SECONDS;
  report(
    `[perf] crew pool ${pooled} crew, ${s.ships.length} ships, ${SPAN_SECONDS} steps: ${ms.toFixed(0)} ms, ${(perStep * 1000).toFixed(1)} us per step`,
  );
  // Every transport stayed in the pool (the fleet was full), and the span ran.
  expect(out.gameTimeSeconds).toBe(s.gameTimeSeconds + SPAN_SECONDS);
  expect(totalCrew(out.crewPool)).toBeGreaterThanOrEqual(pooled);
  expect(perStep).toBeLessThan(PER_STEP_BUDGET_MS);
}
