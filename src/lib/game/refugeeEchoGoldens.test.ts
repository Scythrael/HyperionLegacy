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

const GOLDEN: Record<string, unknown> = {
  "rolls:slot0": "f7e5b5e1",
  "rolls:slot1": "f5a95b7c",
  "rolls:slot2": "11d89549",
  "rolls:slot3": "3b05b6cc",
  "apply:open": "ed626816",
  "apply:taper": "f0a36ee3",
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
    for (const [k, v] of Object.entries(rollPins())) pin(k, v);
  });
  it("applyRefugeeDeliveries over 600 Evacuations, open and tapered", () => {
    for (const [k, v] of Object.entries(applyPins())) pin(k, v);
  });
});

describe.runIf(CAPTURE)("E5-6b capture (E5_6B_CAPTURE = an output path): write the goldens there", () => {
  it("writes", () => {
    writeFileSync(String(import.meta.env.E5_6B_CAPTURE), JSON.stringify(captured, null, 2));
  });
});
