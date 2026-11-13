// E5-6b (echo refugees; design docs/plans/2026-11-02-refugee-posts-e5-design.md "USER (2026-11-03, verbatim): rare
// franchise nods among refugees" and "USER ANSWER (2026-11-13): echo roster sign-off"; roster
// docs/plans/2026-11-03-refugee-echo-roster-DRAFT.md): the goldens, captured on `0b5892e7` BEFORE any engine edit.
//
// Pins:
//   - `rolls`: rollRefugee for 4 slots x 750 cycles of the default board (3,000 real rolls, both tiers, ids 1..3000),
//     hashed per slot. The refugee each roll brings home before echoes existed.
//   - `apply:open` and `apply:taper`: applyRefugeeDeliveries over 600 Evacuation deliveries on those rolls, with a
//     huge open-post count (everyone arrives) and with 4 open posts (the taper); the resulting state and events hashed.
//
// Capture: `E5_6B_CAPTURE=<path> npx vitest run src/lib/game/refugeeEchoGoldens.test.ts` writes every pin to <path>.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { freshState, type GameState } from "./model";
import { rollShortRangeJob, type ShortRangeRoll } from "./shortRange";
import { shortRangeBoardSlots } from "./shortRangeBoard";
import { applyRefugeeDeliveries, rollRefugee, type RefugeeDelivery } from "./refugeeArrival";
import type { RefugeeState } from "./refugees";
import { hash } from "./firstRunsGoldens.fixture";
import { refugeeEchoOf } from "./refugeeEchoes";
import { withEchoRefugeesOff } from "./refugeeEchoSwitch.fixture";

const GOLDEN: Record<string, unknown> = {
  "rolls:slot0": "f7e5b5e1",
  "rolls:slot1": "f5a95b7c",
  "rolls:slot2": "11d89549",
  "rolls:slot3": "3b05b6cc",
  "apply:open": "ed626816",
  "apply:taper": "f0a36ee3",
  // E5-6b live (echoes on). Traced: with withEchoRefugeesOff the six pins above still read exactly, and the overlay
  // tests below prove only the echoes' name, background and key moved.
  "e5-6b:rolls:slot0": "d2f8b02b",
  "e5-6b:rolls:slot1": "b805d649",
  "e5-6b:rolls:slot2": "7bdd1f0f",
  "e5-6b:rolls:slot3": "3750cef9",
  "e5-6b:apply:open": "db4f1554",
  "e5-6b:apply:taper": "1840b49a",
};

const CAPTURE = Boolean(import.meta.env.E5_6B_CAPTURE);
const captured: Record<string, unknown> = {};
function pin(key: string, value: unknown): void {
  if (CAPTURE) {
    captured[key] = value;
    return;
  }
  expect(value, key).toEqual(GOLDEN[key]);
}

function withMissionControl(state: GameState, level: number): GameState {
  return { ...state, facilities: { ...state.facilities, missionControl: { ...state.facilities.missionControl, level } } };
}

// 750 real rolls per slot of a fresh board with Mission Control at Level 3 (four slots, both tiers).
function rollsBySlot(): ShortRangeRoll[][] {
  const s = withMissionControl(freshState(), 3);
  return shortRangeBoardSlots(s).map((slot) => Array.from({ length: 750 }, (_, c) => rollShortRangeJob(s, slot, c)));
}

function rollPins(): Record<string, string> {
  const out: Record<string, string> = {};
  rollsBySlot().forEach((rolls, slotId) => {
    out[`rolls:slot${slotId}`] = hash(rolls.map((roll, i) => rollRefugee(roll, slotId * 750 + i + 1, i * 10)));
  });
  return out;
}

const EMPTY: RefugeeState = { version: 1, list: [], nextId: 1, arrivedTotal: 0, greet: [] };

function deliveries(): RefugeeDelivery[] {
  const bySlot = rollsBySlot();
  const out: RefugeeDelivery[] = [];
  for (let i = 0; i < 150; i++) {
    for (let slotId = 0; slotId < 4; slotId++) {
      const roll = bySlot[slotId][i];
      out.push({ kind: "evacuation", atTick: i + 1, slotId, roll: { ...roll, difficulty: { ...roll.difficulty, firstRun: false } } });
    }
  }
  return out;
}

function applyPins(): Record<string, string> {
  const call = { gameTimeSeconds: 1000, tickDurationSeconds: 1 };
  const open = applyRefugeeDeliveries(EMPTY, 1e9, deliveries(), call);
  const taper = applyRefugeeDeliveries(EMPTY, 4, deliveries(), call);
  return { "apply:open": hash(open), "apply:taper": hash(taper) };
}

describe("E5-6b goldens: who comes home, before echoes", () => {
  it("rollRefugee over 3,000 real rolls", () => {
    // The pins, traced: the game before E5-6b (echoes off) reads them exactly.
    for (const [k, v] of Object.entries(withEchoRefugeesOff(rollPins))) pin(k, v);
    // With echoes live: the new pins.
    for (const [k, v] of Object.entries(rollPins())) pin(`e5-6b:${k}`, v);
  });
  it("applyRefugeeDeliveries over 600 Evacuations, open and tapered", () => {
    for (const [k, v] of Object.entries(withEchoRefugeesOff(applyPins))) pin(k, v);
    for (const [k, v] of Object.entries(applyPins())) pin(`e5-6b:${k}`, v);
  });
});

describe("E5-6b: the echo overlay moves only the echoes", () => {
  it("every roll's record is unchanged except an echo's name, background and key", () => {
    let echoes = 0;
    rollsBySlot().forEach((rolls, slotId) => {
      rolls.forEach((roll, i) => {
        const id = slotId * 750 + i + 1;
        const on = rollRefugee(roll, id, i * 10);
        const off = withEchoRefugeesOff(() => rollRefugee(roll, id, i * 10));
        if (on.echo === undefined) {
          expect(on).toEqual(off);
          return;
        }
        echoes += 1;
        const echo = refugeeEchoOf(on.echo)!;
        expect(on).toEqual({ ...off, name: echo.name, background: echo.background, echo: echo.key });
      });
    });
    // About 1 in 50 of 3,000 (60 expected): the measured count sits within a wide binomial band.
    expect(echoes).toBeGreaterThan(30);
    expect(echoes).toBeLessThan(95);
  });

  it("applyRefugeeDeliveries: the same arrivals at the same ids; echoes once each", () => {
    const call = { gameTimeSeconds: 1000, tickDurationSeconds: 1 };
    for (const open of [1e9, 4]) {
      const on = applyRefugeeDeliveries(EMPTY, open, deliveries(), call);
      const off = withEchoRefugeesOff(() => applyRefugeeDeliveries(EMPTY, open, deliveries(), call));
      expect(on.refugees.list.map((r) => r.id)).toEqual(off.refugees.list.map((r) => r.id));
      expect(on.events.map((e) => [e.kind, e.atTick, e.slotId, e.refugeeId])).toEqual(off.events.map((e) => [e.kind, e.atTick, e.slotId, e.refugeeId]));
      const keys = on.refugees.list.flatMap((r) => (r.echo === undefined ? [] : [r.echo]));
      expect(new Set(keys).size).toBe(keys.length);
      expect(on.refugees.echoes ?? []).toEqual(keys);
      expect(off.refugees.echoes).toBeUndefined();
      if (open === 1e9) expect(keys.length).toBeGreaterThan(0);
    }
  });
});

describe.runIf(CAPTURE)("E5-6b capture (E5_6B_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.E5_6B_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
