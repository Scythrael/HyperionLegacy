// E5-4 (Refugee Posts, plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-4): the facility buffs a posted
// refugee gives, each measured through its real consumer, and the determinism the plan asks for (the buffs apply at a
// defined moment; one call == 997 s chunks == 1 s steps; offline == live; nobody posted is the game before E5-4).

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { BLUEPRINTS, SHIP_TYPES, freshState, type GameState, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { diminishing } from "./diminishing";
import {
  REFUGEE_BACKGROUNDS,
  REFUGEE_BACKGROUND_KEYS,
  REFUGEE_FACILITY_KEYS,
  type RefugeeBackground,
  type RefugeeFacilityKey,
  type RefugeeRecord,
  type RefugeeState,
} from "./refugees";
import {
  REFUGEE_BUFFS_SWITCH,
  REFUGEE_MATCH_SHARE_PER_SKILL,
  REFUGEE_OFF_MATCH_RATIO,
  REFUGEE_STACK_KNEE,
  refugeeBonusIfPosted,
  refugeeDurationTicks,
  refugeeFacilityBonus,
  refugeeRefineBonus,
  refugeeShare,
  refugeeShortRangePlan,
} from "./refugeeBuffs";
import {
  canResearch,
  economyTick,
  fabricateDurationTicks,
  fleetReachBonus,
  museumResearchDurationTicks,
  researchSpeedFor,
  shipBuildDurationTicks,
  shipBuildSpeedMult,
  shipRangeLightYears,
  startLine,
  startProcess,
  startResearch,
  tick,
} from "./tick";
import { museumBonuses } from "./relics";
import { hullTeardownFraction, salvageYieldMult } from "./salvage";
import { shortRangeBoardSlots, startShortRangeCycle } from "./shortRangeBoard";
import { SHORT_RANGE_TEMPLATE_KEYS, rollShortRangeJob } from "./shortRange";
import { deserialize, migrate, serialize, type SaveFile } from "./save";
import { dispatchRun, editShip, installPiece, readProbe, refugeeBase, shipOf, wiringBase, withRefugeePosted } from "./wiring/probes";
import { resolveCrew } from "./crewOverlay";
import { withRefugeeBuffsOff } from "./refugeeBuffsSwitch.fixture";

const RNG = (): number => 0.5;
const json = (v: unknown): string => JSON.stringify(v);
const canon = (g: GameState): string =>
  JSON.stringify({ ...g, discovered: [...g.discovered].sort() }, (_k, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );

function person(id: number, background: RefugeeBackground, skill: number, posting: RefugeeFacilityKey | null): RefugeeRecord {
  return { id, name: `Person ${id}`, background, skill, origin: { tier: 1, destinationIndex: 0 }, portrait: { hair: 0, palette: 0 }, arrivedAtSeconds: 0, posting };
}

function withPeople(s: GameState, list: RefugeeRecord[]): GameState {
  const refugees: RefugeeState = { version: 1, list, nextId: list.length + 1, arrivedTotal: list.length, greet: [] };
  return { ...s, refugees };
}

// The matched person for `facility` (skill 50), posted there.
function matched(s: GameState, facility: RefugeeFacilityKey, skill = 50): GameState {
  const bg = REFUGEE_BACKGROUND_KEYS.find((b) => REFUGEE_BACKGROUNDS[b].facility === facility)!;
  return withRefugeePosted(s, bg, facility, skill);
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

describe("E5-4 shares and the stacking curve", () => {
  it("refugeeShare: skill x 0.001 at the match, a quarter of it anywhere else", () => {
    expect(refugeeShare({ background: "refiner", skill: 42 }, "refinery")).toBeCloseTo(0.042, 12);
    expect(refugeeShare({ background: "refiner", skill: 42 }, "fabricator")).toBeCloseTo(0.0105, 12);
    expect(REFUGEE_MATCH_SHARE_PER_SKILL).toBe(0.001);
    expect(REFUGEE_OFF_MATCH_RATIO).toBe(0.25);
  });

  it("refugeeFacilityBonus: 0 with nobody posted (or only people waiting), diminishing(sum, knee) with two", () => {
    const s = refugeeBase();
    expect(refugeeFacilityBonus(s, "refinery")).toBe(0);
    expect(refugeeFacilityBonus(withPeople(s, [person(1, "refiner", 50, null)]), "refinery")).toBe(0);
    const two = withPeople(s, [person(1, "refiner", 42, "refinery"), person(2, "scholar", 60, "refinery")]);
    expect(refugeeFacilityBonus(two, "refinery")).toBe(diminishing(0.042 + 0.06 * REFUGEE_OFF_MATCH_RATIO, REFUGEE_STACK_KNEE));
    expect(refugeeFacilityBonus(two, "research")).toBe(0);
  });

  it("D23: strictly increasing as people stack, and unbounded (never a cap)", () => {
    let s = refugeeBase();
    let last = 0;
    for (let i = 0; i < 400; i++) {
      s = withRefugeePosted(s, "refiner", "refinery", 75);
      const b = refugeeFacilityBonus(s, "refinery");
      expect(b).toBeGreaterThan(last);
      last = b;
    }
    // 400 people of skill 75: the raw sum is 30; the curve keeps growing past any small ceiling.
    expect(last).toBeGreaterThan(4.5);
    expect(last).toBeLessThan(30);
  });

  it("refugeeBonusIfPosted: the gain and the total if posted now, a swap on a full facility, 0 on a failed post", () => {
    const s = withPeople(refugeeBase(), [person(1, "refiner", 40, "refinery"), person(2, "refiner", 60, null)]);
    const r = refugeeBonusIfPosted(s, 2, "refinery");
    expect(r.total).toBe(diminishing(0.06, REFUGEE_STACK_KNEE)); // Level 1 has one post: person 1 is swapped out
    expect(r.gain).toBeCloseTo(r.total - diminishing(0.04, REFUGEE_STACK_KNEE), 15);
    const unbuilt = { ...s, facilities: { ...s.facilities, refinery: { level: 0 } } };
    expect(refugeeBonusIfPosted(unbuilt, 2, "refinery")).toEqual({ gain: 0, total: refugeeFacilityBonus(unbuilt, "refinery") });
  });

  it("the test-only switch off reads every buff as 0 (the game before E5-4)", () => {
    const s = matched(refugeeBase(), "refinery");
    expect(refugeeFacilityBonus(s, "refinery")).toBeGreaterThan(0);
    expect(withRefugeeBuffsOff(() => refugeeFacilityBonus(s, "refinery"))).toBe(0);
    expect(REFUGEE_BUFFS_SWITCH.live).toBe(true);
  });
});

describe("E5-4 the folds are the identity with nobody posted", () => {
  it("every consumer reads bit-identically with refugees waiting (none posted) and with no refugees at all", () => {
    const s = refugeeBase();
    const waiting = withPeople(s, REFUGEE_BACKGROUND_KEYS.map((b, i) => person(i + 1, b, 70, null)));
    const read = (g: GameState) => ({
      reach: fleetReachBonus(g),
      build: shipBuildSpeedMult(g),
      salvage: salvageYieldMult(g),
      research: researchSpeedFor(g, museumBonuses(g).researchSpeed),
      fabricate: fabricateDurationTicks(g, 320),
      scan: dispatchRun(g).scanParams,
      plan: startShortRangeCycle(g, shipOf(g), { id: 0, tier: 1 }, 3, undefined, false).plan,
    });
    expect(json(read(waiting))).toBe(json(read(s)));
    expect(refugeeDurationTicks(320, 0)).toBe(320);
    const plan = startShortRangeCycle(s, shipOf(s), { id: 0, tier: 1 }, 3, undefined, false).plan;
    expect(refugeeShortRangePlan(s, plan)).toBe(plan);
  });

  it("a refine job without a Refinery refugee carries no bonusOutput key (no draw taken)", () => {
    const r = startProcess(refugeeBase(), "refineJob", {}, 20, { type: "addItem", itemId: "titaniumIngot", amount: new Decimal(1) });
    expect("bonusOutput" in r.next.activeProcesses[0]).toBe(false);
    expect(refugeeRefineBonus(0, 1, 0)).toBe(false);
  });
});

describe("E5-4 each background's buff measurably acts through its consumer (one matched refugee, skill 50)", () => {
  const b50 = diminishing(0.05, REFUGEE_STACK_KNEE);

  it("Refiner: a real refine batch of 200 (1 s steps) delivers about b extra batches; offline == live", () => {
    const b0 = refugeeBase();
    const base: GameState = { ...b0, inventory: { ...b0.inventory, commonOre: [new Decimal(200 * 20)] } };
    const run = (s: GameState) => startLine(s, "refine", "refineCommonOre", { kind: "batch", remaining: 200 }).next;
    // Each refineCommonOre job is 12 ticks on one Level 1 lane; the line starts the next job on the tick after.
    const ticks = 200 * 13 + 40;
    const ingots = (g: GameState) => Number((g.inventory.titaniumIngot ?? []).reduce((a, d) => a.plus(d), new Decimal(0)));
    const off = stepped(run(base), ticks);
    const onStart = run(matched(base, "refinery"));
    const on = stepped(onStart, ticks);
    expect(ingots(off)).toBe(200);
    const extra = ingots(on) - 200;
    expect(extra).toBeGreaterThan(0);
    // 200 jobs at b ~ 4.8%: about 9.5 extra, within the sample's spread.
    expect(Math.abs(extra / 200 - b50)).toBeLessThan(0.05);
    // The roll is keyed by the job's process number, so the offline catch-up (1 s steps inside tick) lands the same.
    expect(json(tick(ticks, onStart, RNG).inventory)).toBe(json(on.inventory));
  });

  it("Fuel handler: fleet reach adds b, so every hull's range grows by (1 + r + b) / (1 + r)", () => {
    const s = refugeeBase();
    const on = matched(s, "fuelStorage");
    expect(fleetReachBonus(on) - fleetReachBonus(s)).toBeCloseTo(b50, 15);
    for (const hull of ["generalFreighter", "eir"] as ShipTypeKey[]) {
      const ship = { ...shipOf(s), typeKey: hull };
      expect(shipRangeLightYears(on, ship) / shipRangeLightYears(s, ship)).toBeCloseTo((1 + fleetReachBonus(on)) / (1 + fleetReachBonus(s)), 12);
    }
  });

  it("Dispatcher: frozen at the cycle start; a posting mid-cycle changes only the next cycle", () => {
    const s = refugeeBase();
    const slot = { id: 0, tier: 1 as const };
    const before = startShortRangeCycle(s, shipOf(s), slot, 5, undefined, false).plan;
    const posted = matched(s, "missionControl");
    const after = startShortRangeCycle(posted, shipOf(posted), slot, 5, undefined, false).plan;
    expect(after.totalTicks).toBeLessThan(before.totalTicks);
    expect(after.transitOutTicks).toBe(Math.max(1, Math.ceil(before.transitOutTicks / (1 + b50))));
    // A run in flight: its stored plan is what tickCaptainShortRange reads; posting changes nothing in it, and its next
    // cycle (started on the posted state) is the shorter plan.
    const flying = qualifiedRun(qualified());
    const mission = flying.captains[0].mission as ShortRangeMissionState;
    const repost = matched(flying, "missionControl");
    expect((repost.captains[0].mission as ShortRangeMissionState).plan).toBe(mission.plan);
    const nextCycleAt = mission.plan.totalTicks + 1;
    const plain = economyTick(flying, nextCycleAt, RNG).captains[0].mission as ShortRangeMissionState;
    const sped = economyTick(repost, nextCycleAt, RNG).captains[0].mission as ShortRangeMissionState;
    expect(sped.roll).toEqual(plain.roll);
    expect(sped.plan.totalTicks).toBeLessThan(plain.plan.totalTicks);
  });

  it("Scholar: a real research start and the relic study fold divide by (1 + b) at the start", () => {
    const ready: GameState = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, research: { level: 9 } }, credits: new Decimal(1e12) };
    const key = Object.keys(BLUEPRINTS).find((k) => canResearch(ready, k).ok && BLUEPRINTS[k].researchDurationTicks >= 100)!;
    const ticksOf = (g: GameState) => startResearch(g, key).next.activeProcesses.at(-1)!.durationTicks;
    const base = BLUEPRINTS[key].researchDurationTicks;
    expect(ticksOf(ready)).toBe(base);
    expect(ticksOf(matched(ready, "research"))).toBe(Math.max(1, Math.ceil(base / (1 + b50))));
    expect(museumResearchDurationTicks(1800, researchSpeedFor(matched(ready, "research"), 0))).toBe(Math.ceil(1800 / (1 + b50)));
  });

  it("Machinist: a fabricate job's duration divides by (1 + b) at the start (line jobs and one-off crafts read one seam)", () => {
    const s = refugeeBase();
    const on = matched(s, "fabricator");
    for (const ticks of [120, 160, 300, 340]) expect(fabricateDurationTicks(on, ticks)).toBe(Math.ceil(ticks / (1 + b50)));
    expect(fabricateDurationTicks(on, 1)).toBe(1);
    // Across the blueprint catalog: most crafts shorten (a 1-tick unlock-only blueprint cannot).
    const moved = Object.values(BLUEPRINTS).filter((bp) => fabricateDurationTicks(on, bp.craftDurationTicks) < bp.craftDurationTicks).length;
    expect(moved).toBeGreaterThan(Object.keys(BLUEPRINTS).length * 0.9);
  });

  it("Shipwright: build speed times (1 + b), so every hull builds in base / (1 + b)", () => {
    const s = refugeeBase();
    const on = matched(s, "shipyard");
    for (const hull of Object.keys(SHIP_TYPES) as ShipTypeKey[]) {
      expect(shipBuildDurationTicks(on, hull)).toBeCloseTo(shipBuildDurationTicks(s, hull) / (1 + b50), 9);
    }
  });

  it("Salvager: the recovery fraction times (1 + b), recycle and teardown", () => {
    const s = refugeeBase();
    const on = matched(s, "salvageBay");
    expect(salvageYieldMult(on)).toBeCloseTo(salvageYieldMult(s) * (1 + b50), 15);
    for (const d of [0, 0.5, 0.999]) expect(hullTeardownFraction(on, d)).toBeCloseTo(hullTeardownFraction(s, d) * (1 + b50), 12);
  });

  it("Stargazer: both discovery pools' odds rise by b at dispatch, more finds over 24 bodies, a run in flight keeps its odds", () => {
    const s = refugeeBase();
    const on = matched(s, "subspaceTelescope");
    const a = dispatchRun(s).scanParams;
    const b = dispatchRun(on).scanParams;
    expect(b.landmarkOddsBias - a.landmarkOddsBias).toBeCloseTo(b50, 15);
    expect(b.undergroundPoiOddsBias - a.undergroundPoiOddsBias).toBeCloseTo(b50, 15);
    expect(readProbe("expDiscoveryOdds", on, "expedition:groundOps")).toBeGreaterThan(readProbe("expDiscoveryOdds", s, "expedition:groundOps"));
    expect(readProbe("expDiscoveries", on, "expedition:groundOps")).toBeGreaterThan(readProbe("expDiscoveries", s, "expedition:groundOps"));
  });
});

// A crewed Eir with a sensor array (meets the Tier I sheet), Mission Control at Level 3, every berth rung, every
// template a veteran, and every refugee facility built; captain 1 flying slot 0 on Repeat from its cycle 3.
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(refugeeBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  const s = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  return {
    ...s,
    transitBerthCapacity: 8,
    facilities: { ...s.facilities, missionControl: { level: 3 } },
    runCounts: {
      version: 1,
      expedition: { completed: 0, trainingDone: false, veteran: false },
      patrol: { dispatched: 0, completed: 0, veteran: false },
      shortRange: Object.fromEntries(SHORT_RANGE_TEMPLATE_KEYS.map((k) => [k, { dispatched: 20, completed: 20 }])),
    },
  };
}

function qualifiedRun(q: GameState, captainId = 1, slotId = 0): GameState {
  const slot = shortRangeBoardSlots(q)[slotId];
  const idx = 3;
  const board = { ...(q.shortRangeBoard ?? { version: 1 as const, nextCycle: {} }), nextCycle: { ...(q.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const withBoard = { ...q, shortRangeBoard: board };
  const ship = withBoard.ships.find((sh) => sh.assignedCaptainId === captainId)!;
  const start = startShortRangeCycle(withBoard, ship, slot, idx, undefined, false);
  const mission: ShortRangeMissionState = { kind: "shortRange", slotId, roll: start.roll, plan: start.plan, phase: "transitOut", phaseProgressTicks: 0, recalled: false };
  expect(rollShortRangeJob(withBoard, slot, idx)).toEqual(start.roll);
  return { ...withBoard, captains: withBoard.captains.map((c) => (c.id === captainId ? { ...c, mission } : c)), runCounts: start.runCounts };
}

describe("E5-4 determinism: every facility staffed, a short-range run on Repeat and a refine batch", () => {
  // Every refugee facility staffed (a matched person at each), a short-range run on Repeat (the Dispatcher at each cycle start, reach on the gate) and a refine batch (the Refiner's
  // keyed roll at each job start).
  function staffed(): GameState {
    let s = qualifiedRun(qualified());
    for (const f of REFUGEE_FACILITY_KEYS) s = matched(s, f, 40 + REFUGEE_FACILITY_KEYS.indexOf(f) * 5);
    s = { ...s, inventory: { ...s.inventory, commonOre: [new Decimal(400 * 20)] } };
    return startLine(s, "refine", "refineCommonOre", { kind: "batch", remaining: 400 }).next;
  }
  // The same staffing and run without the refine line: a craft line steps once per economyTick call (the shipped
  // economy only ever steps one tick at a time, and the offline catch-up does too), so the one-call comparison reads
  // the cycle engine alone; the line's parity is the offline == live check below.
  function fleetOnly(): GameState {
    let s = qualifiedRun(qualified());
    for (const f of REFUGEE_FACILITY_KEYS) s = matched(s, f, 40 + REFUGEE_FACILITY_KEYS.indexOf(f) * 5);
    return s;
  }

  it("one 2 h call == 997 s chunks == 1 s steps (a short-range run on Repeat, every facility staffed)", () => {
    const s0 = fleetOnly();
    const N = 2 * 3600;
    const steps = stepped(s0, N);
    // Compared with object keys sorted and `discovered` as a set: within one call an item's FIRST-SEEN order follows
    // the delivery fold, not time (pre-existing, the refugeeGoldens golden 2 note; with the buffs off too). No reader
    // depends on that order.
    expect(canon(chunked(s0, N))).toBe(canon(steps));
    expect(canon(economyTick(s0, N, RNG))).toBe(canon(steps));
    // The Dispatcher acted: the same span without the buffs flies other cycles.
    const plain = withRefugeeBuffsOff(() => stepped(s0, N));
    expect(json(plain.captains)).not.toBe(json(steps.captains));
  });

  it("offline == live: a 1 h offline catch-up through the save equals live 1 s steps", () => {
    const roundTrip = (g: GameState) => migrate(deserialize(serialize(g, 0, 1_790_000_000_000)) as SaveFile, 1);
    const s0 = roundTrip(staffed());
    expect(refugeeFacilityBonus(s0, "missionControl")).toBeGreaterThan(0);
    const N = 3600;
    const live = stepped(s0, N);
    const offline = tick(N, roundTrip(s0), RNG);
    expect(json(offline.captains)).toBe(json(live.captains));
    expect(json(offline.inventory)).toBe(json(live.inventory));
    expect(json(offline.activeProcesses)).toBe(json(live.activeProcesses));
  });

  it("a fresh save is untouched: no refugees key, every buff 0", () => {
    const fresh = freshState();
    expect("refugees" in fresh).toBe(false);
    for (const f of REFUGEE_FACILITY_KEYS) expect(refugeeFacilityBonus(fresh, f)).toBe(0);
    expect(wiringBase().refugees).toBeUndefined();
  });
});

