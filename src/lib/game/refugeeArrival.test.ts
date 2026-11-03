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
import { REFUGEE_TAPER_K, applyRefugeeDeliveries, refugeeArrivalChance, rollRefugee, type RefugeeDelivery } from "./refugeeArrival";
import { REFUGEE_BACKGROUND_KEYS, REFUGEE_SKILL_SPANS, refugeesOf, type RefugeeRecord, type RefugeeState } from "./refugees";
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
      const a = rollRefugee(roll, 7, 100);
      expect(json(rollRefugee(roll, 7, 100))).toBe(json(a));
      const [lo, hi] = REFUGEE_SKILL_SPANS[roll.tier];
      expect(Number.isInteger(a.skill) && a.skill >= lo && a.skill <= hi).toBe(true);
      expect(REFUGEE_BACKGROUND_KEYS).toContain(a.background);
      expect(a.origin).toEqual({ tier: roll.tier, destinationIndex: roll.destinationIndex });
      expect(a.posting).toBeNull();
      // The id moves only the name's stream: the six draws are the roll's.
      const b = rollRefugee(roll, 8, 100);
      expect({ ...b, id: 7, name: a.name }).toEqual(a);
    }
    // Tier II rolls stronger on average (a harder evacuation brings a more capable person).
    const mean = (t: 1 | 2) => {
      const rs = rolls.filter((r) => r.tier === t);
      return rs.reduce((n, r) => n + rollRefugee(r, 1, 0).skill, 0) / rs.length;
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
    // Relocations do nothing yet (E5-3), and no delivery returns the same reference.
    const relocation = { ...training, template: "refugeeRelocation" as const };
    const r = applyRefugeeDeliveries(crowd, 0, [{ kind: "relocation", atTick: 1, slotId: 0, roll: relocation }], call);
    expect(r.refugees).toBe(crowd);
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
    expect(r.list[0]).toEqual(rollRefugee(m.roll, 1, s0.gameTimeSeconds + m.plan.totalTicks * s0.tickDurationSeconds));
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

describe("E5-2 determinism (Review Focus 4): two Evacuations delivered on the same tick on slots 0 and 2", () => {
  // Captains 1 and 2 (identical hulls) on Repeat on slots 0 and 2, each at the start of its home turnaround, so both
  // deliver on the same tick; a crowd waiting past the open posts, so arrivals and misses both happen over the span.
  function pair(): GameState {
    let s = withWaiting(veteran(withSecondCaptain(qualified())), 6);
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
    const first = refugeeLog(steps).slice(0, 2);
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
    expect(refugeesOf(live).list.length).toBeGreaterThan(6);
    expect(json(offline.refugees)).toBe(json(live.refugees));
    expect(json(refugeeLog(offline))).toBe(json(refugeeLog(live)));
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
