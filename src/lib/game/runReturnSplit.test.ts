// Lane 4 M8 follow-up (docs/qa/2026-11-13-fable-sweep-ledger.md lane 4 M8; review of 6d0368bb): EVERY RUN'S RETURN
// SPLITS A LONGER CALL, not only a patrol's. A ship home from an extraction mission or a Short-Range run inside a call
// stayed crew-locked for the call's earlier transport windows (crewOverlay.ts resolveCrew held it locked from the call's
// start) and counted crew hours to the call's end, so one economyTick call differed from 1 s steps (997 s chunks
// matched only by luck). economyTick now splits the call at the whole tick ANY run comes home: a patrol's end, an
// extraction mission's last delivery (or its at-base stop), a Short-Range run's last delivery, an expedition's
// completion, and a mission whose key is gone (dropped at once). One call, 997 s chunks and 1 s steps now leave the
// same state, byte for byte, for each. Production steps one tick per call, where nothing splits; the last block proves
// tick() byte-identical with the fix on and off on each of these runs ending.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState } from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, itemCap, recallCaptain, tick } from "./tick";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { advanceExpedition, expeditionCompletionTick } from "./expedition";
import { resolveCrew } from "./crewOverlay";
import { WIRING_CAPTAIN_ID, editShip, installPiece, seatOfficer, wiringBase } from "./wiring/probes";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import { cp16ExpeditionBase } from "./cp16Goldens.fixture";
import { withLane4M8Off, withPatrolHomeSplitOff } from "./patrolHomeSplitSwitch.fixture";
import { crewModuleSiOffForThisFile } from "./crewModuleSiSwitch.fixture";

// Standard-Issue crew modules (0.14.0, user 2026-11-17 "free basic set, all ships"): this file's pins predate the
// free Sensor Suite, Bridge Module and Crew Quarters every ship now carries (their berths, officer lift, hull bonus
// and equipment ids), so the set is off here and the pins keep proving their own slice. The set itself is pinned in
// crewModuleStandardIssue.test.ts.
crewModuleSiOffForThisFile();

const RNG = () => 0.5;

function stepped(s: GameState, n: number, rng: () => number = RNG): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, rng);
  return out;
}
function chunked(s: GameState, total: number, step: number, rng: () => number = RNG): GameState {
  let out = s;
  for (let left = total; left > 0; left -= step) out = economyTick(out, Math.min(step, left), rng);
  return out;
}
const json = (s: GameState): string => JSON.stringify(s);
const buckets = (s: GameState): string => JSON.stringify(s.ships.map((sh) => sh.complement));

// The reviewer's repro: the clock at 7 s, captain 1 on a Short Ore Run, recalled at once; the ship comes home in tick 33.
function recalledOreRun(): GameState {
  const d = dispatchCaptainOnMission({ ...freshState(), gameTimeSeconds: 7 }, 1, "shortOreRun");
  expect(d.success, String(d.reason)).toBe(true);
  const r = recallCaptain(d.next, 1);
  expect(r.success).toBe(true);
  return r.next;
}

describe("an extraction mission's return splits a longer call", () => {
  const T = 9000;
  it("recalled Short Ore Run (home in tick 33): one call == 997 s chunks == 1 s steps, the whole state", { timeout: 300_000 }, () => {
    const start = recalledOreRun();
    const steps = stepped(start, T);
    expect(stepped(start, 33).captains[0].mission).toBeNull();
    expect(stepped(start, 32).captains[0].mission).not.toBeNull();
    expect(json(economyTick(start, T, RNG))).toBe(json(steps));
    expect(json(chunked(start, T, 997))).toBe(json(steps));
  });
  it("with the split off, one call keeps other complement buckets (the bug)", { timeout: 300_000 }, () => {
    const start = recalledOreRun();
    expect(buckets(withPatrolHomeSplitOff(() => economyTick(start, T, RNG)))).not.toBe(buckets(stepped(start, T)));
  });
});

// A one-cycle Short-Range run: a crewed Eir with a sensor array (shortRangeCycle.test.ts `qualified`) flies one cycle
// (Repeat off); its berths are emptied once it is out, so the transports after its return have room to fill.
function shortRangeOneCycle(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 + 7 });
  const s = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  const r = dispatchCaptainOnShortRange(s, WIRING_CAPTAIN_ID, 0, false);
  expect(r.success, String(r.reason)).toBe(true);
  return { ...r.next, ships: r.next.ships.map((sh) => (sh.complement ? { ...sh, complement: { ...sh.complement, buckets: [] } } : sh)) };
}

describe("a Short-Range run's return splits a longer call", () => {
  const T = 9000;
  it("one cycle (Repeat off): one call == 997 s chunks == 1 s steps, the whole state", { timeout: 300_000 }, () => {
    const start = shortRangeOneCycle();
    const steps = stepped(start, T);
    expect(steps.captains[0].mission).toBeNull();
    expect(json(economyTick(start, T, RNG))).toBe(json(steps));
    expect(json(chunked(start, T, 997))).toBe(json(steps));
  });
  it("with the split off, one call differs from 1 s steps (the bug)", { timeout: 300_000 }, () => {
    const start = shortRangeOneCycle();
    expect(json(withPatrolHomeSplitOff(() => economyTick(start, T, RNG)))).not.toBe(json(stepped(start, T)));
  });
});

// The two returns in tick 1: a Short Ore Run still at home on a full warehouse (the at-base cargo stop) and a mission
// whose key is gone (dropped at once).
function atBaseCargoStop(): GameState {
  const d = dispatchCaptainOnMission({ ...freshState(), gameTimeSeconds: 7 }, 1, "shortOreRun");
  expect(d.success, String(d.reason)).toBe(true);
  return { ...d.next, inventory: { ...d.next.inventory, commonOre: [itemCap(d.next, "commonOre")] } };
}
function retiredKey(): GameState {
  const d = dispatchCaptainOnMission({ ...freshState(), gameTimeSeconds: 7 }, 1, "shortOreRun");
  expect(d.success, String(d.reason)).toBe(true);
  const m = d.next.captains[0].mission!;
  if (m.kind !== "extraction") throw new Error("not an extraction mission");
  // A key no table holds (a save from a version that renamed it).
  const gone = { ...m, missionKey: "aRetiredMission" as unknown as typeof m.missionKey };
  return { ...d.next, captains: d.next.captains.map((c) => ({ ...c, mission: gone })) };
}

describe("a run dropped in tick 1 splits a longer call there", () => {
  const T = 9000;
  const cases: [string, () => GameState][] = [
    ["the at-base cargo stop", atBaseCargoStop],
    ["a retired mission key", retiredKey],
  ];
  for (const [name, make] of cases) {
    it(`${name}: one call == 997 s chunks == 1 s steps, the whole state; the split off differs`, { timeout: 300_000 }, () => {
      const start = make();
      const steps = stepped(start, T);
      expect(stepped(start, 1).captains[0].mission).toBeNull();
      expect(json(economyTick(start, T, RNG))).toBe(json(steps));
      expect(json(chunked(start, T, 997))).toBe(json(steps));
      expect(buckets(withPatrolHomeSplitOff(() => economyTick(start, T, RNG)))).not.toBe(buckets(steps));
    });
  }
});

// An expedition 600 s from completing: dispatched (cp16Goldens.fixture.ts, the Tier II run that completes) with an
// officer seated aboard (the crew hours it counts while out), then run and clock moved along together to 600 s before
// it is complete.
function expeditionNearHome(): GameState {
  const d = dispatchPastPropulsion(seatOfficer(cp16ExpeditionBase(), "executive", []), "ship-1", WIRING_CAPTAIN_ID, "cand-2-0");
  expect(d.success, String(d.reason)).toBe(true);
  const s = d.next;
  const done = expeditionCompletionTick(s.expeditions[0], s.gameTimeSeconds, s.tickDurationSeconds, 3_000_000);
  expect(done).not.toBeNull();
  const at = s.gameTimeSeconds + (done! - 600) * s.tickDurationSeconds;
  return { ...s, gameTimeSeconds: at, expeditions: s.expeditions.map((e) => advanceExpedition(e, at)) };
}

describe("an expedition's completion splits a longer call", () => {
  const T = 3000;
  it("it completes in tick 600: one call == 997 s chunks == 1 s steps, the whole state", { timeout: 300_000 }, () => {
    const start = expeditionNearHome();
    expect(stepped(start, 599).expeditions[0].phase).not.toBe("complete");
    expect(stepped(start, 600).expeditions[0].phase).toBe("complete");
    const steps = stepped(start, T);
    expect(json(economyTick(start, T, RNG))).toBe(json(steps));
    expect(json(chunked(start, T, 997))).toBe(json(steps));
  });
  it("with the split off, one call differs from 1 s steps (the bug: crew hours to the call's end)", { timeout: 300_000 }, () => {
    const start = expeditionNearHome();
    expect(json(withPatrolHomeSplitOff(() => economyTick(start, T, RNG)))).not.toBe(json(stepped(start, T)));
  });
});

// LEFTOVER TAPE (tick.ts economyTick): a split call drops the probe's draws no part read. The returned state is the
// two calls made by hand from the start of the same stream, whatever was dropped.
function seeded(seed: number): { rng: () => number; draws: () => number } {
  let x = seed >>> 0;
  let n = 0;
  return {
    rng: () => {
      n += 1;
      x = (Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
      return (x >>> 8) / 0x1000000;
    },
    draws: () => n,
  };
}
const carrierSweep = (repeat: boolean): GameState => {
  const r = dispatchCaptainOnPatrol(asPatrolVeteran({ ...onHull("carrier"), nextPatrolSeed: 1, credits: new Decimal(10_000_000) }), 1, "crimsonReaverSweep", "balanced", repeat);
  expect(r.success, r.reason).toBe(true);
  return r.next;
};

describe("a split call reads the stream as two calls made from the start", () => {
  it("a patrol's return with a stateful rng: one call == the two calls by hand, the whole state", { timeout: 300_000 }, () => {
    const start = carrierSweep(false);
    const T = 6000;
    expect(economyTick(start, T, seeded(7).rng).captains[0].mission).toBeNull();
    // The tick the run comes home in with this stream: the first whole tick a call from the start ends with it home.
    let lo = 1;
    let hi = T;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (economyTick(start, mid, seeded(7).rng).captains[0].mission === null) hi = mid;
      else lo = mid + 1;
    }
    expect(lo).toBeLessThan(T);
    const one = seeded(7);
    const byHand = seeded(7);
    const first = economyTick(start, lo, byHand.rng);
    expect(json(economyTick(start, T, one.rng))).toBe(json(economyTick(first, T - lo, byHand.rng)));
    // The split call drew at least what the two calls by hand read (more when the probe's tape had entries left over).
    expect(one.draws()).toBeGreaterThanOrEqual(byHand.draws());
  });
});

// Production: tick() steps one economyTick per whole tick, where nothing splits.
describe("production (tick()) is unchanged by the fix", () => {
  it("an extraction recall, a Short-Range run, two tick-1 stops, a patrol and an expedition ending: on == off, byte for byte", { timeout: 300_000 }, () => {
    const runs: [GameState, number][] = [
      [recalledOreRun(), 9000],
      [shortRangeOneCycle(), 9000],
      [atBaseCargoStop(), 4000],
      [retiredKey(), 4000],
      [carrierSweep(true), 6000],
      [expeditionNearHome(), 3000],
    ];
    for (const [start, span] of runs) {
      expect(json(tick(span, start, RNG))).toBe(json(withLane4M8Off(() => tick(span, start, RNG))));
    }
  });
});
