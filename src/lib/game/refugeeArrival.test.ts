// E5-2 (Refugee Posts, docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-2): the Evacuation template behind the
// versioned draw, the seeded refugee roll, the arrival taper, the post-pass in economyTick and its log lines, the
// board stamp's load rule, and the determinism the plan asks for (one call == 997 s chunks == 1 s steps; offline ==
// live; an old save's draws identical before each slot's stamp).

import { describe, expect, it } from "vitest";
import { freshState, type CaptainState, type GameState, type ShortRangeMissionState } from "./model";
import {
  EVACUATION_DRAW_SWITCH,
  SHORT_RANGE_DEFAULT_SEED,
  SHORT_RANGE_DESTINATIONS,
  SHORT_RANGE_DRAW_V1_KEYS,
  SHORT_RANGE_SHEETS,
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  drawShortRangeJob,
  drawShortRangeJobAt,
  rollShortRangeJob,
  shortRangeDrawVersion,
  shortRangeRollSeed,
  shortRangeRollUses,
  type ShortRangeRoll,
  type ShortRangeTemplateKey,
} from "./shortRange";
import { shortRangeBoardSlots, shortRangeNextCycle, startShortRangeCycle } from "./shortRangeBoard";
import { tickCaptainShortRange } from "./shortRangeCycle";
import { REFUGEE_TAPER_K, applyRefugeeDeliveries, refugeeArrivalChance, refugeeArrives, refugeeFarewellPick, rollRefugee, type RefugeeDelivery } from "./refugeeArrival";
import { REFUGEE_BACKGROUND_KEYS, REFUGEE_SKILL_SPANS, refugeeOpenPosts, refugeesOf, type RefugeeRecord, type RefugeeState } from "./refugees";
import { economyTick, installMissingCombatBaselines, tick } from "./tick";
import { runCountsOf } from "./runDifficulty";
import { refugeeCompletionLine } from "./homeDashboard";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { makeRng } from "./combat/rng";
import { withEvacuationDrawOff } from "./evacuationDrawSwitch.fixture";
import { WIRING_CAPTAIN_ID, editShip, installPiece, shipOf, wiringBase } from "./wiring/probes";
import { resolveCrew } from "./crewOverlay";

const RNG = (): number => 0.5;
const json = (v: unknown): string => JSON.stringify(v);

// ===== fixtures =====

function veteran(state: GameState): GameState {
  return {
    ...state,
    runCounts: {
      version: 1,
      expedition: { completed: 0, trainingDone: false, veteran: false },
      patrol: { dispatched: 0, completed: 0, veteran: false },
      shortRange: Object.fromEntries(SHORT_RANGE_TEMPLATE_KEYS.map((k) => [k, { dispatched: 20, completed: 20 }])),
    },
  };
}

function withMissionControl(state: GameState, level: number): GameState {
  return { ...state, facilities: { ...state.facilities, missionControl: { ...state.facilities.missionControl, level } } };
}

// A crewed Eir with a sensor array (meets the Tier I sheet), Mission Control at Level 3 (four slots), every berth rung.
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  const s = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  return withMissionControl({ ...s, transitBerthCapacity: 8 }, 3);
}

// The first cycle index from `from` whose roll at `slotId` is `template`.
function cycleFor(s: GameState, template: ShortRangeTemplateKey, slotId: number, from = 0): number {
  const slot = shortRangeBoardSlots(s)[slotId];
  for (let i = from; i < from + 4000; i++) if (rollShortRangeJob(s, slot, i).template === template) return i;
  throw new Error(`no ${template} roll`);
}

// A second captain (id 2) flying a copy of ship-1 (ship-2).
function withSecondCaptain(s: GameState): GameState {
  const c1 = s.captains[0];
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// Captain `captainId` on Repeat on `slotId`, starting at that slot's next Evacuation, through the board's own cycle-start
// seam. `atHome`: the run starts at the beginning of its home turnaround (so two identical hulls deliver together).
function onEvacuation(s: GameState, captainId: number, slotId: number, atHome = false): GameState {
  const idx = cycleFor(s, "evacuation", slotId);
  const board = { ...(s.shortRangeBoard ?? { version: 1 as const, nextCycle: {} }), nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const withBoard = { ...s, shortRangeBoard: board };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === captainId)!;
  const slot = shortRangeBoardSlots(withBoard)[slotId];
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  expect(start.roll.template).toBe("evacuation");
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId,
    roll: start.roll,
    plan: start.plan,
    phase: atHome ? "unloading" : "transitOut",
    phaseProgressTicks: 0,
    recalled: false,
  };
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
}

// `n` people already waiting at home (ids 1..n), so the taper is in play.
function withWaiting(s: GameState, n: number): GameState {
  const list: RefugeeRecord[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Waiting ${i + 1}`,
    background: "scholar",
    skill: 30,
    origin: { tier: 1, destinationIndex: 0 },
    portrait: { hair: 0, palette: 0 },
    arrivedAtSeconds: 0,
    posting: null,
  }));
  const refugees: RefugeeState = { version: 1, list, nextId: n + 1, arrivedTotal: n, greet: [] };
  return { ...s, refugees };
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

const refugeeLog = (g: GameState) => g.completionLog.filter((e) => e.kind === "refugeeArrival" || e.kind === "refugeeNoArrival");

// ===== the versioned draw =====

describe("E5-2 the versioned draw: version 1 is today's roll; version 2 adds Evacuation 1 in 8 and moves nothing else", () => {
  const fresh = withMissionControl(freshState(), 3);
  const seeds = [SHORT_RANGE_DEFAULT_SEED, 0x5eed0e50 ^ 0x51a7e0b5, 12345];
  const stampOf = () => ({ version: 1 as const, firstRun: false, ramp: 1, tier: 1 as const });

  it("version 1 equals drawShortRangeJob (the pre-E5-2 roll) for every golden 1 case, and never draws Evacuation", () => {
    for (const seed of seeds) {
      for (const slot of shortRangeBoardSlots(fresh)) {
        for (let c = 0; c < 64; c++) {
          const s = shortRangeRollSeed(seed, slot.id, c);
          const v1 = drawShortRangeJobAt(s, slot, c, stampOf, 1);
          expect(json(v1)).toBe(json(drawShortRangeJob(makeRng(s), s, slot, c, stampOf)));
          expect(v1.template).not.toBe("evacuation");
        }
      }
    }
  });

  it("version 2: the Evacuation share is 1/8 +/- 0.01 over 8,000 pairs; every other roll equals its version 1 roll; no roll exceeds its sheet", () => {
    let evac = 0;
    let n = 0;
    for (let slotId = 0; slotId < 4; slotId++) {
      const slot = { id: slotId, tier: (slotId === 2 ? 2 : 1) as 1 | 2 };
      for (let c = 0; c < 2000; c++) {
        const s = shortRangeRollSeed(SHORT_RANGE_DEFAULT_SEED, slotId, c);
        const v2 = drawShortRangeJobAt(s, slot, c, stampOf, 2);
        n += 1;
        if (v2.template === "evacuation") {
          evac += 1;
          const uses = shortRangeRollUses(v2);
          for (const [k, v] of Object.entries(uses)) expect(v).toBeLessThanOrEqual(SHORT_RANGE_SHEETS[slot.tier][k as keyof (typeof SHORT_RANGE_SHEETS)[1]]);
          expect(v2.seed).toBe(s);
        } else {
          expect(json(v2)).toBe(json(drawShortRangeJobAt(s, slot, c, stampOf, 1)));
        }
      }
    }
    expect(n).toBe(8000);
    expect(Math.abs(evac / n - 0.125)).toBeLessThanOrEqual(0.01);
  });

  it("shortRangeDrawVersion: stamp 5 reads 1 at cycles 0..4 and 2 from 5; no entry reads 2; the switch off reads 1", () => {
    const s = { shortRangeBoard: { version: 1 as const, nextCycle: {}, evacuationFrom: { 0: 5 } } };
    expect([0, 1, 2, 3, 4, 5, 6, 100].map((c) => shortRangeDrawVersion(s, 0, c))).toEqual([1, 1, 1, 1, 1, 2, 2, 2]);
    expect(shortRangeDrawVersion(s, 1, 0)).toBe(2);
    expect(shortRangeDrawVersion({}, 0, 0)).toBe(2);
    expect(withEvacuationDrawOff(() => [shortRangeDrawVersion(s, 0, 9), shortRangeDrawVersion({}, 3, 0)])).toEqual([1, 1]);
    expect(EVACUATION_DRAW_SWITCH.live).toBe(true);
  });

  it("rollShortRangeJob reads the stamp: cycles before it are the seven-template roll, and the switch off is the old game", () => {
    const stamped = { ...fresh, shortRangeBoard: { version: 1 as const, nextCycle: {}, evacuationFrom: { 0: 64, 1: 64, 2: 64, 3: 64 } } };
    for (const slot of shortRangeBoardSlots(fresh)) {
      for (let c = 0; c < 64; c++) {
        const old = withEvacuationDrawOff(() => rollShortRangeJob(fresh, slot, c));
        expect(json(rollShortRangeJob(stamped, slot, c))).toBe(json(old));
      }
    }
    // A fresh board draws the overlay from cycle 0, so Evacuation appears in its first 64 cycles.
    const templates = new Set(Array.from({ length: 64 }, (_, c) => rollShortRangeJob(fresh, { id: 0, tier: 1 }, c).template));
    expect(templates.has("evacuation")).toBe(true);
    expect([...SHORT_RANGE_DRAW_V1_KEYS, "evacuation"]).toEqual([...SHORT_RANGE_TEMPLATE_KEYS]);
  });

  it("Evacuation follows short-range's rules: its first roll is a training run (smallest roll), and it pays like Refugee Relocation", () => {
    const slot = { id: 0, tier: 1 as const };
    const roll = rollShortRangeJob(fresh, slot, cycleFor(fresh, "evacuation", 0));
    expect(roll.difficulty.firstRun).toBe(true);
    expect(roll.guests).toBe(SHORT_RANGE_TEMPLATES.evacuation.rolls[1].guests![0]);
    expect(SHORT_RANGE_TEMPLATES.evacuation.reward).toEqual(SHORT_RANGE_TEMPLATES.refugeeRelocation.reward);
    expect(SHORT_RANGE_TEMPLATES.evacuation.work).toEqual(SHORT_RANGE_TEMPLATES.refugeeRelocation.work);
  });
});

// ===== the taper and the roll =====

describe("E5-2 the taper and the seeded refugee roll", () => {
  it("refugeeArrivalChance: 1 while the waiting list fits the open posts, then smoothly down, never 0", () => {
    expect(REFUGEE_TAPER_K).toBe(4);
    expect(refugeeArrivalChance(0, 0)).toBe(1);
    expect(refugeeArrivalChance(3, 3)).toBe(1);
    expect(refugeeArrivalChance(2, 5)).toBe(1);
    expect(refugeeArrivalChance(7, 3)).toBe(0.5);
    let prev = 1;
    for (let w = 4; w <= 200; w++) {
      const c = refugeeArrivalChance(w, 3);
      expect(c).toBeLessThan(prev);
      prev = c;
    }
    expect(refugeeArrivalChance(1e6, 0)).toBeGreaterThan(0);
  });

  it("rollRefugee is a pure function of (roll.seed, id); the skill sits in the tier's span; the layout is fixed", () => {
    const fresh = withMissionControl(freshState(), 3);
    const rolls: ShortRangeRoll[] = [];
    for (const slotId of [0, 2]) {
      const slot = shortRangeBoardSlots(fresh)[slotId];
      let c = 0;
      while (rolls.filter((r) => r.slotId === slotId).length < 40) {
        const r = rollShortRangeJob(veteran(fresh), slot, c++);
        if (r.template === "evacuation") rolls.push(r);
      }
    }
    for (const roll of rolls) {
      const a = rollRefugee(roll, 7, 100, []);
      expect(json(rollRefugee(roll, 7, 100, []))).toBe(json(a));
      const [lo, hi] = REFUGEE_SKILL_SPANS[roll.tier];
      expect(Number.isInteger(a.skill) && a.skill >= lo && a.skill <= hi).toBe(true);
      expect(REFUGEE_BACKGROUND_KEYS).toContain(a.background);
      expect(a.origin).toEqual({ tier: roll.tier, destinationIndex: roll.destinationIndex });
      expect(a.posting).toBeNull();
      // The id moves only the name's stream: the six draws are the roll's.
      const b = rollRefugee(roll, 8, 100, []);
      expect({ ...b, id: 7, name: a.name }).toEqual(a);
    }
    // Tier II rolls stronger on average (a harder evacuation brings a more capable person).
    const mean = (t: 1 | 2) => {
      const rs = rolls.filter((r) => r.tier === t);
      return rs.reduce((n, r) => n + rollRefugee(r, 1, 0, []).skill, 0) / rs.length;
    };
    expect(mean(2)).toBeGreaterThan(mean(1));
  });

  it("applyRefugeeDeliveries: a training run always arrives; a miss mints no id; ids, arrivedTotal and greet advance per arrival", () => {
    const fresh = withMissionControl(freshState(), 3);
    const slot = shortRangeBoardSlots(fresh)[0];
    const training = rollShortRangeJob(fresh, slot, cycleFor(fresh, "evacuation", 0));
    expect(training.difficulty.firstRun).toBe(true);
    // A crowd far past the open posts: the chance is tiny, yet the training run brings someone.
    const crowd = refugeesOf(withWaiting(fresh, 400));
    const call = { gameTimeSeconds: 1000, tickDurationSeconds: 1 };
    const t = applyRefugeeDeliveries(crowd, 0, [{ kind: "evacuation", atTick: 3, slotId: 0, roll: training }], call);
    expect(t.events.map((e) => e.kind)).toEqual(["arrival"]);
    expect(t.refugees.list.at(-1)).toMatchObject({ id: 401, arrivedAtSeconds: 1003, posting: null });
    expect([t.refugees.nextId, t.refugees.arrivedTotal, t.refugees.greet]).toEqual([402, 401, [401]]);

    // Veteran rolls against the same crowd: mostly misses, each minting nothing.
    const vet = veteran(fresh);
    const deliveries: RefugeeDelivery[] = [];
    for (let c = 0, n = 0; n < 30; c++) {
      const r = rollShortRangeJob(vet, slot, c);
      if (r.template === "evacuation") deliveries.push({ kind: "evacuation", atTick: ++n, slotId: 0, roll: r });
    }
    const v = applyRefugeeDeliveries(crowd, 0, deliveries, call);
    const arrivals = v.events.filter((e) => e.kind === "arrival").length;
    const misses = v.events.filter((e) => e.kind === "noArrival").length;
    expect(arrivals + misses).toBe(30);
    expect(misses).toBeGreaterThan(0);
    expect(v.refugees.nextId).toBe(401 + arrivals);
    expect(v.refugees.arrivedTotal).toBe(400 + arrivals);
    expect(v.refugees.greet).toHaveLength(arrivals);
    // With open posts to spare, every one arrives.
    const e = applyRefugeeDeliveries(refugeesOf(fresh), 1000, deliveries, call);
    expect(e.events.every((x) => x.kind === "arrival")).toBe(true);
    expect(e.refugees.list.map((r) => r.id)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // A Relocation with nobody waiting does nothing (E5-3 owns the farewell), and returns the same reference.
    const relocation = { ...training, template: "refugeeRelocation" as const };
    const empty = refugeesOf(fresh);
    const r = applyRefugeeDeliveries(empty, 0, [{ kind: "relocation", atTick: 1, slotId: 0, roll: relocation }], call);
    expect(r.refugees).toBe(empty);
    expect(r.events).toEqual([]);
  });
});

// ===== the cycle engine and the post-pass =====

describe("E5-2 the cycle engine reports deliveries; economyTick brings people home and logs it", () => {
  it("tickCaptainShortRange reports one RefugeeDelivery per delivered Evacuation, with the cycle's atTick", () => {
    const s = onEvacuation(qualified(), WIRING_CAPTAIN_ID, 0);
    const captain = s.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!;
    const m = captain.mission as ShortRangeMissionState;
    const r = tickCaptainShortRange({
      ticksElapsed: m.plan.totalTicks + 2,
      captain,
      state: s,
      ship: shipOf(s),
      creditsBudget: 1e9,
      berthBudget: 8,
      runCounts: runCountsOf(s),
      nextCycle: s.shortRangeBoard!.nextCycle,
      atCap: () => false,
    });
    expect(r.refugeeDeliveries.map((d) => [d.kind, d.atTick, d.slotId, d.roll.cycleIndex])).toEqual([["evacuation", m.plan.totalTicks, 0, m.roll.cycleIndex]]);
  });

  it("a delivered training Evacuation brings one named refugee home and writes the arrival line", () => {
    const s0 = onEvacuation(qualified(), WIRING_CAPTAIN_ID, 0);
    const m = s0.captains[0].mission as ShortRangeMissionState;
    expect(m.roll.difficulty.firstRun).toBe(true);
    expect(s0.refugees).toBeUndefined();
    const before = economyTick(s0, m.plan.totalTicks - 1, RNG);
    expect(before.refugees).toBeUndefined();
    const s = economyTick(before, 1, RNG);
    const r = refugeesOf(s);
    expect(r.list).toHaveLength(1);
    expect(r.list[0]).toEqual(rollRefugee(m.roll, 1, s0.gameTimeSeconds + m.plan.totalTicks * s0.tickDurationSeconds, []));
    expect([r.nextId, r.arrivedTotal, r.greet]).toEqual([2, 1, [1]]);
    const log = refugeeLog(s);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "refugeeArrival", refugee: { id: 1, name: r.list[0].name, background: r.list[0].background } });
    const line = refugeeCompletionLine(log[0])!;
    expect(line).toMatch(/^Evacuation complete: .+, a [a-z ]+, joins your homeworld\.$/);
    expect(line).not.toMatch(/—|--|\bfit/);
    // Pay and XP are the board's own (the Refugee Relocation row).
    expect(Number(s.lifetimeStats.missionsCompleted["shortRange:evacuation"])).toBe(1);
  });

  it("a miss writes the calm line and mints nobody", () => {
    // A crowd waiting with no open posts at all, a veteran fleet: find an Evacuation whose arrival draw misses.
    let s0 = withWaiting(veteran(qualified()), 400);
    s0 = { ...s0, facilities: Object.fromEntries(Object.entries(s0.facilities).map(([k, f]) => [k, k === "missionControl" ? f : { ...f, level: 0 }])) as GameState["facilities"] };
    let from = 0;
    for (;;) {
      const idx = cycleFor(s0, "evacuation", 0, from);
      const roll = rollShortRangeJob(s0, shortRangeBoardSlots(s0)[0], idx);
      const out = applyRefugeeDeliveries(refugeesOf(s0), 0, [{ kind: "evacuation", atTick: 1, slotId: 0, roll }], { gameTimeSeconds: 0, tickDurationSeconds: 1 });
      if (out.events[0].kind === "noArrival") {
        s0 = { ...s0, shortRangeBoard: { version: 1, nextCycle: { 0: idx } } };
        break;
      }
      from = idx + 1;
    }
    const start = startShortRangeCycle(s0, shipOf(s0), shortRangeBoardSlots(s0)[0], shortRangeNextCycle(s0, 0), undefined, false);
    const mission: ShortRangeMissionState = { kind: "shortRange", slotId: 0, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: true };
    const s1 = { ...s0, runCounts: start.runCounts, captains: s0.captains.map((c) => (c.id === WIRING_CAPTAIN_ID ? { ...c, mission } : c)) };
    const s = economyTick(s1, start.plan.totalTicks, RNG);
    expect(s.refugees).toBe(s1.refugees);
    const log = refugeeLog(s);
    expect(log.map((e) => e.kind)).toEqual(["refugeeNoArrival"]);
    const line = refugeeCompletionLine(log[0])!;
    const where = SHORT_RANGE_DESTINATIONS.surface[start.roll.destinationIndex];
    expect(line).toBe(`Evacuate ${where} complete. Everyone aboard reached the camps; nobody new came home this time.`);
    // Inside one tick the run's own end line comes first, then the outcome (the 1 s step order).
    const kinds = s.completionLog.slice(-2).map((e) => e.kind);
    expect(kinds).toEqual(["shortRangeRun", "refugeeNoArrival"]);
  });
});

// ===== determinism =====

// The slow-start parity fix (shortRangeCycle.ts tickShortRangeFleet): each determinism block runs on a veteran fleet
// AND on a fresh one (every template still on its slow-start ramp), which a long call used to split from 1 s steps.
const FLEETS = { veteran, fresh: (s: GameState): GameState => s } as const;

for (const [fleetName, fleet] of Object.entries(FLEETS)) describe(`E5-2 determinism (Review Focus 4): two Evacuations delivered on the same tick on slots 0 and 2 (a ${fleetName} fleet)`, () => {
  // Captains 1 and 2 (identical hulls) on Repeat on slots 0 and 2, each at the start of its home turnaround, so both
  // deliver on the same tick; a crowd waiting past the open posts, so arrivals and misses both happen over the span.
  function pair(): GameState {
    let s = withWaiting(fleet(withSecondCaptain(qualified())), 6);
    s = onEvacuation(s, 1, 0, true);
    s = onEvacuation(s, 2, 2, true);
    const [a, b] = s.captains.map((c) => c.mission as ShortRangeMissionState);
    expect(a.plan.unloadTicks).toBe(b.plan.unloadTicks);
    return s;
  }

  it("one 6 h call, 997 s chunks and 1 s steps give the same refugees, ids, order and log", () => {
    const s0 = pair();
    const N = 6 * 3600;
    const once = economyTick(s0, N, RNG);
    const chunks = chunked(s0, N);
    const steps = stepped(s0, N);
    const view = (g: GameState) => ({ refugees: g.refugees, log: refugeeLog(g), board: g.shortRangeBoard, counts: g.runCounts });
    expect(json(view(chunks))).toBe(json(view(steps)));
    expect(json(view(once))).toBe(json(view(steps)));
    // The same-tick pair lands in slot order, and the span saw both outcomes.
    // E5-3 trace: read at the pair's own delivery tick, not as the 6 h log's first two lines. The Repeat runs also roll
    // Refugee Relocations, whose farewell lines (E5-3) fill the capped log, so its oldest surviving lines are later ones.
    const unload = (s0.captains[0].mission as ShortRangeMissionState).plan.unloadTicks;
    const first = refugeeLog(stepped(s0, unload)).slice(0, 2);
    expect(first.map((e) => e.subjectKey)).toEqual(["slot-0", "slot-2"]);
    const kinds = new Set(refugeeLog(steps).map((e) => e.kind));
    expect(kinds).toEqual(new Set(["refugeeArrival", "refugeeNoArrival"]));
  });

  it("offline == live: a 2 h offline replay through the save equals live 1 s steps", () => {
    // Loaded once first, so both sides start from the state a player's save holds (the load gives the bare fixture its
    // homeworld, which seeds the board); live then steps it, offline saves, loads and catches up through tick().
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const s0 = roundTrip(pair());
    expect(s0.captains.every((c) => c.mission?.kind === "shortRange")).toBe(true);
    const N = 2 * 3600;
    const live = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    // E5-3 trace: people arrived (arrivedTotal); the list itself can shrink now, as Relocations take people along.
    expect(refugeesOf(live).arrivedTotal).toBeGreaterThan(6);
    expect(json(offline.refugees)).toBe(json(live.refugees));
    expect(json(refugeeLog(offline))).toBe(json(refugeeLog(live)));
  });
});

describe("E5-2 determinism: a facility upgrade completing mid-span counts for an Evacuation delivered after it", () => {
  // One captain on an Evacuation (a veteran fleet, so not the training run); the Refinery at Level 0 with its Level 1
  // upgrade in flight, completing halfway through the run, so the delivery sees one more open post than the call's
  // incoming state. The waiting list is sized so that one post decides the arrival draw.
  function midSpanUpgrade(): { s0: GameState; deliverAt: number; arrivesWithUpgrade: boolean } {
    let base = veteran(qualified());
    base = { ...base, facilities: { ...base.facilities, refinery: { ...base.facilities.refinery, level: 0 } } };
    base = onEvacuation(base, WIRING_CAPTAIN_ID, 0);
    const m = base.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!.mission as ShortRangeMissionState;
    expect(m.roll.difficulty.firstRun).toBe(false);
    const open = refugeeOpenPosts(base);
    let waiting = -1;
    for (let w = open + 1; w < open + 4000; w++) {
      if (refugeeArrives(m.roll, w, open) !== refugeeArrives(m.roll, w, open + 1)) {
        waiting = w;
        break;
      }
    }
    expect(waiting).toBeGreaterThan(0);
    const upAt = Math.floor(m.plan.totalTicks / 2);
    const s0: GameState = {
      ...withWaiting(base, waiting),
      activeProcesses: [
        ...base.activeProcesses,
        { id: "proc-refinery-up", kind: "facilityUpgrade", remainingTicks: upAt, durationTicks: upAt + 100, effect: { type: "facilityLevelUp", facility: "refinery" } },
      ],
    };
    expect(refugeeOpenPosts({ ...s0, facilities: { ...s0.facilities, refinery: { ...s0.facilities.refinery, level: 1 } } })).toBe(open + 1);
    return { s0, deliverAt: m.plan.totalTicks, arrivesWithUpgrade: refugeeArrives(m.roll, waiting, open + 1) };
  }

  it("one call == 997 s chunks == 1 s steps == offline catch-up (identical state and arrivals)", () => {
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const { s0: raw, deliverAt, arrivesWithUpgrade } = midSpanUpgrade();
    const s0 = roundTrip(raw);
    expect(s0.activeProcesses.some((p) => p.id === "proc-refinery-up")).toBe(true);
    const N = deliverAt + 5;
    const once = economyTick(s0, N, RNG);
    const chunks = chunked(s0, N);
    const steps = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    const view = (g: GameState) => ({ refugees: g.refugees, log: refugeeLog(g), facilities: g.facilities, processes: g.activeProcesses });
    expect(json(view(chunks))).toBe(json(view(steps)));
    expect(json(view(once))).toBe(json(view(steps)));
    expect(json(view(offline))).toBe(json(view(steps)));
    expect(json(once)).toBe(json(steps));
    // The upgrade landed, and the delivery's outcome is the one the upgraded post count decides.
    expect(steps.facilities.refinery.level).toBe(1);
    expect(refugeeLog(steps).map((e) => e.kind)).toEqual([arrivesWithUpgrade ? "refugeeArrival" : "refugeeNoArrival"]);
  });
});

// ===== the board stamp on load (the E5-1 review item) =====

describe("E5-2 a malformed evacuation stamp drops alone; the board's cursor is kept", () => {
  function loadWithBoard(board: unknown): GameState {
    const save = deserialize(serialize(installMissingCombatBaselines(freshState()), 0, 1_790_000_000_000)) as SaveFile;
    return migrate({ ...save, state: { ...(save as { state: object }).state, shortRangeBoard: board } } as SaveFile, 1);
  }

  it("a fractional stamp is dropped, the cursor stays", () => {
    const s = loadWithBoard({ version: 1, nextCycle: { 0: 12, 1: 7 }, evacuationFrom: { 0: 2.5 } });
    expect(s.shortRangeBoard).toEqual({ version: 1, nextCycle: { 0: 12, 1: 7 } });
  });

  it("a non-object stamp is dropped, the cursor stays; a good stamp is kept; a bad cursor still drops the board", () => {
    expect(loadWithBoard({ version: 1, nextCycle: { 0: 3 }, evacuationFrom: "soon" }).shortRangeBoard).toEqual({ version: 1, nextCycle: { 0: 3 } });
    expect(loadWithBoard({ version: 1, nextCycle: { 0: 3 }, evacuationFrom: { 0: 4 } }).shortRangeBoard).toEqual({ version: 1, nextCycle: { 0: 3 }, evacuationFrom: { 0: 4 } });
    expect(loadWithBoard({ version: 1, nextCycle: { 0: -1 }, evacuationFrom: { 0: 4 } }).shortRangeBoard).toBeUndefined();
  });
});

// ===== E5-3: a Refugee Relocation takes one waiting refugee =====

// Captain `captainId` on Repeat on `slotId`, starting at that slot's next `template` roll (the onEvacuation seam, any
// template). `atHome`: the run starts at the beginning of its home turnaround.
function onTemplate(s: GameState, template: ShortRangeTemplateKey, captainId: number, slotId: number, atHome = false): GameState {
  const idx = cycleFor(s, template, slotId);
  const board = { ...(s.shortRangeBoard ?? { version: 1 as const, nextCycle: {} }), nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const withBoard = { ...s, shortRangeBoard: board };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === captainId)!;
  const slot = shortRangeBoardSlots(withBoard)[slotId];
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  expect(start.roll.template).toBe(template);
  const mission: ShortRangeMissionState = {
    kind: "shortRange",
    slotId,
    roll: start.roll,
    plan: start.plan,
    phase: atHome ? "unloading" : "transitOut",
    phaseProgressTicks: 0,
    recalled: false,
  };
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
}

const farewellLog = (g: GameState) => g.completionLog.filter((e) => e.kind === "refugeeFarewell");
const peopleLog = (g: GameState) => g.completionLog.filter((e) => e.kind === "refugeeArrival" || e.kind === "refugeeNoArrival" || e.kind === "refugeeFarewell");

describe("E5-3 a delivered Refugee Relocation takes the longest-waiting refugee along to lead the new camp", () => {
  const call = { gameTimeSeconds: 0, tickDurationSeconds: 1 };
  const relocationRoll = (): ShortRangeRoll => {
    const fresh = withMissionControl(freshState(), 3);
    return rollShortRangeJob(fresh, shortRangeBoardSlots(fresh)[0], cycleFor(fresh, "refugeeRelocation", 0));
  };

  it("refugeeFarewellPick: the lowest id among the waiting, never a posted refugee, null when nobody waits", () => {
    const base = refugeesOf(withWaiting(freshState(), 4));
    const posted: RefugeeState = { ...base, list: base.list.map((r) => (r.id <= 2 ? { ...r, posting: "refinery" } : r)) };
    expect(refugeeFarewellPick(base)?.id).toBe(1);
    expect(refugeeFarewellPick(posted)?.id).toBe(3);
    // List order does not matter: the id does (ids are minted in arrival order).
    expect(refugeeFarewellPick({ ...posted, list: [...posted.list].reverse() })?.id).toBe(3);
    expect(refugeeFarewellPick({ ...base, list: base.list.map((r) => ({ ...r, posting: "shipyard" as const })) })).toBeNull();
    expect(refugeeFarewellPick(refugeesOf(freshState()))).toBeNull();
  });

  it("with three waiting (and one posted) it removes the lowest-id waiting refugee only and emits one farewell", () => {
    const base = refugeesOf(withWaiting(freshState(), 4));
    const r0: RefugeeState = { ...base, list: base.list.map((r) => (r.id === 1 ? { ...r, posting: "research" } : r)), greet: [3, 4] };
    const roll = relocationRoll();
    const out = applyRefugeeDeliveries(r0, 0, [{ kind: "relocation", atTick: 7, slotId: 0, roll }], call);
    expect(out.refugees.list.map((r) => r.id)).toEqual([1, 3, 4]);
    expect(out.refugees.list[0].posting).toBe("research");
    expect([out.refugees.arrivedTotal, out.refugees.nextId]).toEqual([r0.arrivedTotal, r0.nextId]);
    expect(out.refugees.greet).toEqual([3, 4]);
    expect(out.events).toEqual([
      { kind: "farewell", atTick: 7, slotId: 0, refugeeId: 2, name: "Waiting 2", background: "scholar", destinationIndex: roll.destinationIndex, tier: roll.tier },
    ]);
    // A leaver still queued for an arrival card leaves the queue too.
    const queued = applyRefugeeDeliveries({ ...r0, greet: [2, 4] }, 0, [{ kind: "relocation", atTick: 1, slotId: 0, roll }], call);
    expect(queued.refugees.greet).toEqual([4]);
    // Two relocations take two people, oldest first; a third with nobody left waiting does nothing.
    const three = applyRefugeeDeliveries(r0, 0, [1, 2, 3, 4].map((t) => ({ kind: "relocation" as const, atTick: t, slotId: 1, roll })), call);
    expect(three.events.map((e) => e.refugeeId)).toEqual([2, 3, 4]);
    expect(three.refugees.list.map((r) => r.id)).toEqual([1]);
    expect(three.refugees.arrivedTotal).toBe(r0.arrivedTotal);
  });

  it("the farewell writes a refugeeFarewell entry and the mockup's line", () => {
    let s0 = withWaiting(veteran(qualified()), 3);
    s0 = onTemplate(s0, "refugeeRelocation", WIRING_CAPTAIN_ID, 0);
    const m = s0.captains[0].mission as ShortRangeMissionState;
    const s = economyTick(s0, m.plan.totalTicks, RNG);
    expect(refugeesOf(s).list.map((r) => r.id)).toEqual([2, 3]);
    expect(refugeesOf(s).arrivedTotal).toBe(3);
    const log = farewellLog(s);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ refugee: { id: 1, name: "Waiting 1", background: "scholar" }, refugeeOrigin: { tier: m.roll.tier, destinationIndex: m.roll.destinationIndex } });
    const where = SHORT_RANGE_DESTINATIONS.surface[m.roll.destinationIndex];
    const line = refugeeCompletionLine(log[0]);
    expect(line).toBe(`Waiting 1 leaves to lead the new camp on ${where}.`);
    expect(line).not.toMatch(/—|--|\bfit/);
  });

  it("Review Focus 2: with nobody waiting (everyone posted, or no refugees) the run delivers and logs exactly as before", () => {
    const run = (s0: GameState) => {
      const s = onTemplate(s0, "refugeeRelocation", WIRING_CAPTAIN_ID, 0);
      const m = s.captains[0].mission as ShortRangeMissionState;
      return { s, out: economyTick(s, m.plan.totalTicks + 5, RNG) };
    };
    // No refugees at all: no refugees key is written, and the whole state equals the same run with the E5 field absent.
    const none = run(veteran(qualified()));
    expect(none.out.refugees).toBeUndefined();
    expect(farewellLog(none.out)).toEqual([]);
    // Everyone posted: the same refugees object, and every other field as the run with no refugees.
    const all = withWaiting(veteran(qualified()), 2);
    const allPosted: GameState = { ...all, refugees: { ...all.refugees!, list: all.refugees!.list.map((r) => ({ ...r, posting: "refinery" as const })) } };
    const posted = run(allPosted);
    expect(posted.out.refugees).toBe(posted.s.refugees);
    expect(json({ ...posted.out, refugees: undefined })).toBe(json({ ...none.out, refugees: undefined }));
    expect(peopleLog(posted.out)).toEqual([]);
  });
});

for (const [fleetName, fleet] of Object.entries(FLEETS)) describe(`E5-3 determinism: an Evacuation and a Relocation delivered on the same tick resolve in slotId order (a ${fleetName} fleet)`, () => {
  // Two identical hulls at the start of their home turnaround, so both deliver on the same tick. Nobody waiting at the
  // start, so the order decides the outcome: an Evacuation on the lower slot brings someone home and the Relocation then
  // takes them along; the other way round the Relocation finds nobody and the newcomer stays.
  // Veteran and fresh: with two captains still in a template's slow-start ramp, a long call diverged from 1 s steps
  // before the slow-start parity fix (the board's cycle cursor and runCounts); the fresh fleet now proves it holds.
  function pair(evacSlot: number, relocSlot: number): GameState {
    let s = fleet(withSecondCaptain(qualified()));
    s = onTemplate(s, "evacuation", 1, evacSlot, true);
    s = onTemplate(s, "refugeeRelocation", 2, relocSlot, true);
    const [a, b] = s.captains.map((c) => c.mission as ShortRangeMissionState);
    expect(a.plan.unloadTicks).toBe(b.plan.unloadTicks);
    expect(refugeeArrivalChance(0, refugeeOpenPosts(s))).toBe(1); // nobody waiting: this Evacuation brings someone home
    return s;
  }

  for (const [evacSlot, relocSlot, leaves] of [[0, 2, true], [2, 0, false]] as const) {
    it(`Evacuation on slot ${evacSlot}, Relocation on slot ${relocSlot}: one call == 997 s chunks == 1 s steps (${leaves ? "the newcomer leaves" : "the newcomer stays"})`, () => {
      const s0 = pair(evacSlot, relocSlot);
      const m = s0.captains[0].mission as ShortRangeMissionState;
      const firstDelivery = m.plan.unloadTicks;
      const once1 = economyTick(s0, firstDelivery, RNG);
      const r = refugeesOf(once1);
      expect(r.arrivedTotal).toBe(1);
      expect(r.list.map((x) => x.id)).toEqual(leaves ? [] : [1]);
      expect(r.greet).toEqual(leaves ? [] : [1]);
      const kinds = peopleLog(once1).map((e) => [e.kind, e.subjectKey]);
      expect(kinds).toEqual(
        leaves ? [["refugeeArrival", `slot-${evacSlot}`], ["refugeeFarewell", `slot-${relocSlot}`]] : [["refugeeArrival", `slot-${evacSlot}`]]
      );
      // Over 6 h (more Evacuations and Relocations on Repeat), however the span is cut.
      const N = 6 * 3600;
      const once = economyTick(s0, N, RNG);
      const chunks = chunked(s0, N);
      const steps = stepped(s0, N);
      const view = (g: GameState) => ({ refugees: g.refugees, log: peopleLog(g), board: g.shortRangeBoard, counts: g.runCounts });
      expect(json(view(chunks))).toBe(json(view(steps)));
      expect(json(view(once))).toBe(json(view(steps)));
      expect(farewellLog(steps).length).toBeGreaterThan(0);
    });
  }

  it("offline == live: a 2 h offline replay through the save equals live 1 s steps, farewells included", () => {
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const s0 = roundTrip(withWaiting(pair(0, 2), 3));
    const N = 2 * 3600;
    const live = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    expect(farewellLog(live).length).toBeGreaterThan(0);
    expect(json(offline.refugees)).toBe(json(live.refugees));
    expect(json(peopleLog(offline))).toBe(json(peopleLog(live)));
  });
});

// ===== E5-6b: echo refugees through the tick =====

// Captain `captainId` on Repeat on `slotId`, starting at that slot's first Evacuation whose refugee is an echo (with
// nobody arrived yet), at the start of its home turnaround (so two identical hulls deliver together).
function onEchoEvacuation(s: GameState, captainId: number, slotId: number): GameState {
  const slot = shortRangeBoardSlots(s)[slotId];
  let idx = -1;
  for (let i = 0; i < 20000 && idx < 0; i++) {
    const roll = rollShortRangeJob(s, slot, i);
    if (roll.template === "evacuation" && rollRefugee(roll, 1, 0, []).echo !== undefined) idx = i;
  }
  expect(idx).toBeGreaterThanOrEqual(0);
  const board = { ...(s.shortRangeBoard ?? { version: 1 as const, nextCycle: {} }), nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const withBoard = { ...s, shortRangeBoard: board };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === captainId)!;
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  expect(start.roll.template).toBe("evacuation");
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId, roll: start.roll, plan: start.plan, phase: "unloading", phaseProgressTicks: 0, recalled: false };
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
}

for (const [fleetName, fleet] of Object.entries(FLEETS)) describe(`E5-6b determinism: two echo Evacuations delivered on the same tick on slots 0 and 2 (a ${fleetName} fleet)`, () => {
  function pair(): GameState {
    let s = fleet(withSecondCaptain(qualified()));
    s = onEchoEvacuation(s, 1, 0);
    s = onEchoEvacuation(s, 2, 2);
    const [a, b] = s.captains.map((c) => c.mission as ShortRangeMissionState);
    expect(a.plan.unloadTicks).toBe(b.plan.unloadTicks);
    return s;
  }

  it("both arrive as two different echoes, in slot order; one call == 997 s chunks == 1 s steps over 6 h", () => {
    const s0 = pair();
    const first = economyTick(s0, (s0.captains[0].mission as ShortRangeMissionState).plan.unloadTicks, RNG);
    const r = refugeesOf(first);
    expect(r.list).toHaveLength(2);
    const [x, y] = r.list;
    expect(x.echo).toBeDefined();
    expect(y.echo).toBeDefined();
    expect(x.echo).not.toBe(y.echo);
    expect(r.echoes).toEqual([x.echo, y.echo]);
    // The arrival lines name the echoes, slot 0 first.
    expect(refugeeLog(first).map((e) => [e.subjectKey, e.refugee?.name])).toEqual([["slot-0", x.name], ["slot-2", y.name]]);
    const N = 6 * 3600;
    const once = economyTick(s0, N, RNG);
    const chunks = chunked(s0, N);
    const steps = stepped(s0, N);
    const view = (g: GameState) => ({ refugees: g.refugees, log: refugeeLog(g), board: g.shortRangeBoard, counts: g.runCounts });
    expect(json(view(chunks))).toBe(json(view(steps)));
    expect(json(view(once))).toBe(json(view(steps)));
    const keys = refugeesOf(steps).echoes ?? [];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("offline == live: a 2 h offline replay through the save equals live 1 s steps, echoes included", () => {
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const s0 = roundTrip(pair());
    const N = 2 * 3600;
    const live = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    expect(refugeesOf(live).echoes?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(json(offline.refugees)).toBe(json(live.refugees));
    expect(json(refugeeLog(offline))).toBe(json(refugeeLog(live)));
  });
});
