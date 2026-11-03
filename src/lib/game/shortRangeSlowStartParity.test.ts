// Short-range determinism with a FRESH fleet (docs/plans/2026-11-02-refugee-posts-e5-plan.md, the E5-3 carry note):
// two captains on Repeat while their templates are still in the slow-start ramp (the training run, then "full from
// run 12") read the fleet's runCounts at every cycle start, so the order those starts and the other captain's
// deliveries happen in decides each roll. One long call, 997 s chunks, 1 s steps and the offline catch-up must give the
// same full state (offline == live == one call == chunks == steps).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type CaptainState, type GameState, type ShortRangeMissionState } from "./model";
import { shortRangeBoardSlots, startShortRangeCycle } from "./shortRangeBoard";
import { economyTick, tick } from "./tick";
import { runCountsOf } from "./runDifficulty";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { editShip, installPiece, shipOf, wiringBase } from "./wiring/probes";
import { resolveCrew } from "./crewOverlay";
import { tickCaptainShortRange, tickShortRangeFleet } from "./shortRangeCycle";
import { withShortRangeFleetOff } from "./shortRangeFleetSwitch.fixture";

const RNG = (): number => 0.5;
const json = (v: unknown): string => JSON.stringify(v);
// The full state with object keys sorted and `discovered` read as the set it is (every reader asks includes()): the
// first-seen ORDER of an item key within one call follows the captain map, not time, for any two-captain fleet (the
// per-call delivery fold), which is not what this file is about. Every value and every array order is compared.
const canon = (g: GameState): string =>
  JSON.stringify({ ...g, discovered: [...g.discovered].sort() }, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );

// A crewed Eir with a sensor array (meets the Tier I sheet), Mission Control at Level 3 (four slots), every berth rung.
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  const s = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  return { ...s, transitBerthCapacity: 8, facilities: { ...s.facilities, missionControl: { ...s.facilities.missionControl, level: 3 } } };
}

// A second captain (id 2) flying a copy of ship-1 (ship-2).
function withSecondCaptain(s: GameState): GameState {
  const c1 = s.captains[0];
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// Captain `captainId` on Repeat on `slotId` at the slot's cycle `idx`, through the board's own cycle-start seam.
function onSlot(s: GameState, captainId: number, slotId: number, idx: number): GameState {
  const board = { ...(s.shortRangeBoard ?? { version: 1 as const, nextCycle: {} }), nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const withBoard = { ...s, shortRangeBoard: board };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === captainId)!;
  const slot = shortRangeBoardSlots(withBoard)[slotId];
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false };
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
}

function fresh(): GameState {
  let s = withSecondCaptain(qualified());
  s = { ...s, credits: new Decimal(1e9) };
  // Slots 0 and 2 from cycle 0: both captains dispatched on a fresh fleet, every template still on its ramp.
  s = onSlot(s, 1, 0, 0);
  s = onSlot(s, 2, 2, 0);
  return s;
}

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

function chunked(s: GameState, n: number, size = 997): GameState {
  let out = s;
  for (let left = n; left > 0; left -= size) out = economyTick(out, Math.min(size, left), RNG);
  return out;
}

describe("short-range slow start: two captains on Repeat, a fresh fleet", () => {
  it("starts on the ramp (no template veteran), so the cycle starts read live counts", () => {
    const s0 = fresh();
    const counts = runCountsOf(s0).shortRange;
    for (const c of Object.values(counts)) expect(c.completed).toBe(0);
    expect(s0.captains.every((c) => c.mission?.kind === "shortRange")).toBe(true);
  });

  it("one 6 h call == 997 s chunks == 1 s steps on the full state", () => {
    const s0 = fresh();
    const N = 6 * 3600;
    const steps = stepped(s0, N);
    // The span actually walked the ramp on both captains (several cycles each).
    const done = Object.values(runCountsOf(steps).shortRange).reduce((a, c) => a + c.completed, 0);
    expect(done).toBeGreaterThan(6);
    const chunks = chunked(s0, N);
    const once = economyTick(s0, N, RNG);
    expect(json(chunks.shortRangeBoard)).toBe(json(steps.shortRangeBoard));
    expect(json(chunks.runCounts)).toBe(json(steps.runCounts));
    expect(json(once.shortRangeBoard)).toBe(json(steps.shortRangeBoard));
    expect(json(once.runCounts)).toBe(json(steps.runCounts));
    expect(canon(chunks)).toBe(canon(steps));
    expect(canon(once)).toBe(canon(steps));
  });

  it("offline == live: a 2 h offline replay through the save equals live 1 s steps", () => {
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const s0 = roundTrip(fresh());
    const N = 2 * 3600;
    const live = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    const once = economyTick(s0, N, RNG);
    expect(canon(offline)).toBe(canon(live));
    // tick() stamps its own clock fields; the cycle engine's outputs match one call too.
    const engine = (g: GameState) => ({ ...g, x: [g.shortRangeBoard, g.runCounts, g.captains, g.credits, g.inventory, g.lifetimeStats, g.completionLog] });
    expect(JSON.parse(canon(engine(once))).x).toEqual(JSON.parse(canon(engine(offline))).x);
  });

  it("the switch off (the game before the fix) diverges, so this file pins the bug", () => {
    const s0 = fresh();
    const N = 6 * 3600;
    const steps = stepped(s0, N);
    const before = withShortRangeFleetOff(() => economyTick(s0, N, RNG));
    expect(json(before.shortRangeBoard)).not.toBe(json(steps.shortRangeBoard));
    // A call of one tick never takes the fleet path: the switch changes nothing there.
    const one = economyTick(s0, 1, RNG);
    expect(json(withShortRangeFleetOff(() => economyTick(s0, 1, RNG)))).toBe(json(one));
  });

  it("alone, the fleet scheduler is the one-captain engine exactly", () => {
    const s0 = fresh();
    const input = {
      ticksElapsed: 5000,
      captain: s0.captains[0],
      state: s0,
      ship: s0.ships.find((sh) => sh.assignedCaptainId === 1),
      creditsBudget: 1e9,
      berthBudget: 8,
      runCounts: runCountsOf(s0),
      nextCycle: s0.shortRangeBoard!.nextCycle,
      atCap: () => false,
    };
    const fleet = tickShortRangeFleet([input], input.runCounts, input.nextCycle);
    const alone = tickCaptainShortRange(input);
    expect(json(fleet.results[0])).toBe(json(alone));
    expect(json(fleet.runCounts)).toBe(json(alone.runCounts));
    expect(fleet.budgetDraw).toBe(alone.budgetDraw);
    expect(fleet.berthsClaimed).toBe(alone.berthsClaimed);
  });
});

describe("short-range slow start: budgets drawn in time order across two runs", () => {
  it("a tight berth budget: one call == 997 s chunks == 1 s steps on the board and counters", () => {
    // One free berth for two hulls: the berth hold binds, the claims thread in (whole tick, captain order).
    const s0 = { ...fresh(), transitBerthCapacity: 1 };
    const N = 3 * 3600;
    const steps = stepped(s0, N);
    const once = economyTick(s0, N, RNG);
    expect(Object.values(runCountsOf(steps).shortRange).reduce((a, c) => a + c.completed, 0)).toBeGreaterThan(3);
    expect(json(once.runCounts)).toBe(json(steps.runCounts));
    expect(json(once.shortRangeBoard)).toBe(json(steps.shortRangeBoard));
  });
});
