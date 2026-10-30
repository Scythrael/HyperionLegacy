// The crewHours determinism fix (2026-10-30, hub call: "one call == chunked == 1 s steps" is a hard rule): an
// officer's crewHours accrues as a whole-millisecond counter (SeniorStaffOfficer.crewHoursMs, crewOverlay.ts
// foldOfficerPromotionCounters) instead of a float summed per call. The golden files captured before the fix run with
// the float counter (crewHoursSwitch.fixture.ts); this file traces the move they would make: with the fix live, every
// state differs from the float game ONLY in that counter, and the counter is the float's value in whole milliseconds.

import { describe, expect, it } from "vitest";
import type { GameState, SecondaryTalentKey } from "./model";
import { dispatchCaptainOnMission, economyTick } from "./tick";
import { editCaptain, seatOfficer, wiringBase } from "./wiring/probes";
import { constDispatch, cutDispatch } from "./patrolLegLiftsGoldens.fixture";
import { withCrewHoursFloat } from "./crewHoursSwitch.fixture";
import { CREW_HOURS_MS_PER_HOUR, officerPromotionCounter } from "./seniorStaff";

const RNG = (): number => 0.5;
const own = (s: GameState, ...keys: SecondaryTalentKey[]): GameState => editCaptain(s, { unlockedSecondaryTalents: keys });

// Each officer's crewHours in whole milliseconds, and the state with the counter (either form) taken out.
function split(s: GameState): { ms: number[]; rest: unknown } {
  const ms = s.officers.map((o) => o.crewHoursMs ?? Math.round((o.promotionCounters?.crewHours ?? 0) * CREW_HOURS_MS_PER_HOUR));
  const officers = s.officers.map((o) => {
    const { crewHoursMs: _ms, promotionCounters, ...rest } = o;
    const { crewHours: _h, ...counters } = promotionCounters ?? {};
    return Object.keys(counters).length > 0 ? { ...rest, promotionCounters: counters } : rest;
  });
  return { ms, rest: { ...s, officers } };
}

const steps = (start: GameState, n: number): GameState => {
  let s = start;
  for (let i = 0; i < n; i++) s = economyTick(s, 1, RNG);
  return s;
};

// The scenarios the pre-fix goldens cover: an officer out on a mission (with and without Drillmaster's 1.08), on a
// Repeat patrol (relaunches, kills), on a run mixing cycle lengths, and on an hour-long fleet tick; 1 s steps and one call.
const SCENARIOS: Record<string, () => { start: GameState; seconds: number }> = {
  mission: () => ({ start: dispatchCaptainOnMission(seatOfficer(wiringBase(), "science", ["sci.discovery"]), 1, "shortOreRun").next, seconds: 900 }),
  drillmaster: () => ({
    start: dispatchCaptainOnMission(own(seatOfficer(wiringBase(), "science", ["sci.discovery"]), "commandCrew3"), 1, "shortOreRun").next,
    seconds: 900,
  }),
  patrol: () => ({ start: constDispatch("destroyer", "crimsonReaverSweep", false), seconds: 400 }),
  patrolMixed: () => ({ start: constDispatch("battleship", "crimsonReaverSweep", true), seconds: 400 }),
  hourTick: () => ({ start: cutDispatch("carrier", "crimsonReaverSweep"), seconds: 200 }),
};

describe("crewHours in whole milliseconds: the only move is the counter", () => {
  for (const [name, make] of Object.entries(SCENARIOS)) {
    it(`${name}: live == the float game except crewHours, which is the float rounded to whole milliseconds`, () => {
      const { start, seconds } = make();
      for (const [how, run] of [
        ["1 s steps", () => steps(start, seconds)],
        ["one call", () => economyTick(start, seconds, RNG)],
      ] as const) {
        const live = split(run());
        const float = split(withCrewHoursFloat(run));
        expect([name, how, live.ms.some((m) => m > 0)]).toEqual([name, how, true]);
        expect([name, how, live.ms]).toEqual([name, how, float.ms]);
        expect(live.rest).toEqual(float.rest);
      }
    }, 120_000);
  }

  it("and live, one call == 7 s chunks == 1 s steps exactly on every scenario (the float drifted a few ulps)", () => {
    for (const [name, make] of Object.entries(SCENARIOS)) {
      const { start, seconds } = make();
      const stepped = steps(start, seconds);
      let chunked = start;
      for (let t = 0; t < seconds; t += 7) chunked = economyTick(chunked, Math.min(7, seconds - t), RNG);
      const hours = (s: GameState) => s.officers.map((o) => [o.crewHoursMs, officerPromotionCounter(o, "crewHours")]);
      expect([name, hours(economyTick(start, seconds, RNG))]).toEqual([name, hours(stepped)]);
      expect([name, hours(chunked)]).toEqual([name, hours(stepped)]);
    }
  }, 120_000);
});
