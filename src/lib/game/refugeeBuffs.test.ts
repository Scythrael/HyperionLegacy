// E5-4 (Refugee Posts, plan docs/plans/2026-11-02-refugee-posts-e5-plan.md Task E5-4): the facility buffs a posted
// refugee gives, each measured through its real consumer, and the determinism the plan asks for (the buffs apply at a
// defined moment; one call == 997 s chunks == 1 s steps; offline == live; nobody posted is the game before E5-4).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  carriedTicks,
  cleanRefugeeCarry,
  refugeeBonusIfPosted,
  refugeeCarryOf,
  refugeeDurationCarried,
  refugeeDurationTicks,
  refugeeFacilityBonus,
  refugeeRefineBonus,
  refugeeShare,
  refugeeShortRangePlan,
  withRefugeeCarry,
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
  queueRelicStudy,
  researchStartTiming,
  startResearch,
  tick,
} from "./tick";
import { museumBonuses } from "./relics";
import { researchFamilyOf } from "./dataStudy";
import { RESEARCH_FAMILIES } from "./gasGiantContent";
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
    expect(refugeeShortRangePlan(s, plan).plan).toBe(plan);
    expect(refugeeShortRangePlan(s, plan, 0.25).carry).toBe(0.25); // a run's carry passes through untouched
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

// ===== E5-4 fix round: the swap's target, and the carried fractions (the user's 2026-11-03 "Carry the fractions") =====

describe("E5-4 fix round: the bonus preview takes the swap's target", () => {
  it("replacing the stronger person previews the lower total; an invalid target previews no gain", () => {
    // Refinery Level 4: two posts, both taken.
    const base = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, refinery: { level: 4 } } };
    const s = withPeople(base, [person(1, "refiner", 30, "refinery"), person(2, "refiner", 70, "refinery"), person(3, "refiner", 50, null)]);
    const now = refugeeFacilityBonus(s, "refinery");
    const fallback = refugeeBonusIfPosted(s, 3, "refinery");
    const stronger = refugeeBonusIfPosted(s, 3, "refinery", 2);
    expect(fallback.total).toBe(diminishing(0.07 + 0.05, REFUGEE_STACK_KNEE));
    expect(stronger.total).toBe(diminishing(0.03 + 0.05, REFUGEE_STACK_KNEE));
    expect(stronger.gain).toBeLessThan(0);
    expect(refugeeBonusIfPosted(s, 3, "refinery", 3)).toEqual({ gain: 0, total: now });
    expect(refugeeBonusIfPosted(s, 3, "refinery", 99)).toEqual({ gain: 0, total: now });
  });
});

describe("E5-4 fix round: carried fractions (small buffs always act over time)", () => {
  it("a carry never appears with nobody posted (relic queue, research, fabricate starts)", () => {
    const tokens = Array.from({ length: 3 }, (_, i) => ({ id: `plain-${i}`, tier: "standard" as const, quality: 0 }));
    let s: GameState = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, research: { level: 1 } }, relicVault: tokens, relicQueue: [] };
    s = withPeople(s, [person(1, "scholar", 60, null)]);
    for (const t of tokens) s = queueRelicStudy(s, t.id).next;
    const after = stepped(s, 3000);
    expect(after.refugees?.carry).toBeUndefined();
  });

  // The smallest real share: an off-match refugee at the lowest skill an evacuation brings (Tier I: 20).
  const LOW_SKILL = 20;
  const offMatch = (s: GameState, f: RefugeeFacilityKey) =>
    withRefugeePosted(s, REFUGEE_BACKGROUND_KEYS.find((b) => REFUGEE_BACKGROUNDS[b].facility !== f)!, f, LOW_SKILL);

  it("carriedTicks: the first duration is ceil(ideal); a run of them sums within one tick of the ideal; the carry stays in [0, 1)", () => {
    expect(carriedTicks(59.4, 0)).toEqual({ ticks: 60, carry: 60 - 59.4 });
    for (const ideal of [59.70149253731343, 119.4, 0.4, 1, 7.25, 1000 / 1.0477]) {
      let c = 0;
      let sum = 0;
      for (let i = 0; i < 500; i++) {
        const r = carriedTicks(ideal, c);
        expect(Number.isInteger(r.ticks) && r.ticks >= 1).toBe(true);
        expect(r.carry >= 0 && r.carry < 1).toBe(true);
        sum += r.ticks;
        c = r.carry;
      }
      // Within one tick (a float hair either side: the ideal itself is not exact in binary).
      if (ideal >= 1) {
        expect(sum - ideal * 500).toBeGreaterThanOrEqual(-1e-6);
        expect(sum - ideal * 500).toBeLessThan(1 + 1e-6);
      }
    }
    expect(refugeeDurationCarried(60, 0, 0.5)).toEqual({ ticks: 60, carry: 0.5 }); // b = 0: untouched
    expect(cleanRefugeeCarry(1)).toBe(0);
    expect(cleanRefugeeCarry(Number.NaN)).toBe(0);
  });

  it("withRefugeeCarry: a 0 removes the key (and an empty record); no change is the same state; no refugee record is untouched", () => {
    const s = withPeople(refugeeBase(), [person(1, "scholar", 20, "research")]);
    const a = withRefugeeCarry(s, "research", 0.25);
    expect(refugeeCarryOf(a, "research")).toBe(0.25);
    expect(withRefugeeCarry(a, "research", 0.25)).toBe(a);
    const back = withRefugeeCarry(a, "research", 0);
    expect("carry" in back.refugees!).toBe(false);
    expect(withRefugeeCarry(s, "fabricator", 0)).toBe(s);
    const fresh = freshState();
    expect(withRefugeeCarry(fresh, "research", 0.5)).toBe(fresh);
  });

  it("Scholar: an off-match skill-20 refugee rounds away on one 60-tick project, but real research starts in a row save ticks", () => {
    const ready: GameState = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, research: { level: 9 } }, credits: new Decimal(1e15) };
    const on0 = offMatch(ready, "research");
    const b = refugeeFacilityBonus(on0, "research");
    expect(Math.ceil(60 / (1 + b))).toBe(60); // the old rounding swallowed it
    const run = (start: GameState) => {
      let s = start;
      const durations: number[] = [];
      for (let i = 0; i < 40; i++) {
        const key = Object.keys(BLUEPRINTS).find((k) => canResearch(s, k).ok && BLUEPRINTS[k].researchDurationTicks === 60);
        if (key === undefined) break;
        const r = startResearch(s, key);
        durations.push(r.next.activeProcesses.at(-1)!.durationTicks);
        // The project is taken as done (its completion is not what is measured), so the next 60-tick one can start.
        s = { ...r.next, researchedBlueprints: [...(r.next.researchedBlueprints ?? []), key], activeProcesses: [] };
      }
      return { durations, s };
    };
    const off = run(ready);
    const on = run(on0);
    expect(off.durations.every((d) => d === 60)).toBe(true);
    expect(on.durations.length).toBe(off.durations.length);
    expect(on.durations.length).toBeGreaterThanOrEqual(8);
    const sum = on.durations.reduce((a, d) => a + d, 0);
    const ideal = (60 * on.durations.length) / (1 + b);
    expect(sum).toBeLessThan(60 * on.durations.length);
    expect(sum - ideal).toBeGreaterThanOrEqual(-1e-9);
    expect(sum - ideal).toBeLessThan(1);
    // Nobody posted: the carry key never appears.
    expect(off.s.refugees?.carry).toBeUndefined();
  });

  it("Machinist: a 120-tick fabricate line with an off-match skill-20 refugee finishes sooner; offline == live", () => {
    const b0 = refugeeBase();
    const base: GameState = {
      ...b0,
      inventory: { ...b0.inventory, titaniumIngot: [new Decimal(4 * 40)] },
      researchedBlueprints: [...new Set([...(b0.researchedBlueprints ?? []), "frameSegmentBp"])],
    };
    const run = (s: GameState) => startLine(s, "fabricate", "frameSegmentBp", { kind: "batch", remaining: 40 }).next;
    const made = (g: GameState) => Number((g.inventory.frameSegment ?? []).reduce((a, d) => a.plus(d), new Decimal(0)));
    const finishTick = (start: GameState) => {
      let s = start;
      for (let t = 1; t <= 40 * 125; t++) {
        s = economyTick(s, 1, RNG);
        if (made(s) >= 40) return t;
      }
      return -1;
    };
    const offStart = run(base);
    const onStart = run(offMatch(base, "fabricator"));
    expect(Math.ceil(120 / (1 + refugeeFacilityBonus(onStart, "fabricator")))).toBe(120); // one job alone rounds away
    const offAt = finishTick(offStart);
    const onAt = finishTick(onStart);
    expect(offAt).toBeGreaterThan(0);
    expect(onAt).toBeGreaterThan(0);
    expect(offAt - onAt).toBeGreaterThanOrEqual(10); // about 40 x 120 x b / (1 + b) = 24 ticks over the batch
    // Offline == live (tick steps whole ticks), the carry included.
    const N = 2000;
    const live = stepped(onStart, N);
    const offline = tick(N, onStart, RNG);
    expect(json(offline.refugees)).toBe(json(live.refugees));
    expect(json(offline.activeProcesses)).toBe(json(live.activeProcesses));
    expect(json(offline.inventory)).toBe(json(live.inventory));
    expect(refugeeCarryOf(live, "fabricator")).toBeGreaterThan(0);
  });

  it("Dispatcher: a run carries its rounding from cycle to cycle; one call == 997 s chunks == 1 s steps == offline", () => {
    const s0 = offMatch(qualifiedRun(qualified()), "missionControl");
    const N = 6 * 3600;
    const steps = stepped(s0, N);
    expect(canon(chunked(s0, N))).toBe(canon(steps));
    expect(canon(economyTick(s0, N, RNG))).toBe(canon(steps));
    expect(json(tick(N, s0, RNG).captains)).toBe(json(steps.captains));
    // Some cycle on the way carried a fraction (the run stores it); the plain run never has the key.
    let seen = false;
    let s = s0;
    for (let h = 0; h < 6 && !seen; h++) {
      s = stepped(s, 3600);
      const m = s.captains[0].mission as ShortRangeMissionState | null;
      if (m?.refugeeCarry !== undefined) seen = true;
    }
    expect(seen).toBe(true);
    const plain = withRefugeeBuffsOff(() => stepped(s0, N));
    expect(json(plain.captains).includes("refugeeCarry")).toBe(false);
    expect(json(plain.captains)).not.toBe(json(steps.captains));
  });

  it("the three duration probes read real content and move at a low off-match share, within one tick of ideal", () => {
    expect(BLUEPRINTS.frameSegmentBp.researchDurationTicks).toBe(60);
    expect(BLUEPRINTS.classVIIDriveBp.researchDurationTicks).toBe(480);
    expect(BLUEPRINTS.frameSegmentBp.craftDurationTicks).toBe(120);
    expect(BLUEPRINTS.classVIIDriveBp.craftDurationTicks).toBe(1080);
    const rows = [
      ["refugeeResearchTicks", "research", "research"],
      ["refugeeFabricateTicks", "fabricator", "craft"],
      ["refugeeShortRangePhase", "missionControl", "mission:shortRange"],
    ] as const;
    for (const [probe, f, ctx] of rows) {
      const s = offMatch(refugeeBase(), f);
      const off = readProbe(probe, refugeeBase(), ctx) as number;
      const on = readProbe(probe, s, ctx) as number;
      const b = refugeeFacilityBonus(s, f);
      expect(on, probe).toBeLessThan(off);
      expect(Math.abs(on - off / (1 + b)), probe).toBeLessThan(1);
    }
  });

  it("relic study: the player start and the queue chain store the carry; one call == 1 s steps == offline; nobody posted adds no key", () => {
    const tokens = Array.from({ length: 10 }, (_, i) => ({ id: `carry-${i}`, tier: "standard" as const, quality: 0 }));
    const lab = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, research: { level: 1 } } };
    // The player queues all ten (queueRelicStudy: the first starts at once through startRelicStudy, the rest wait for
    // the chain to start them at each completion tick).
    let s0: GameState = { ...offMatch(lab, "research"), relicVault: tokens, relicQueue: [] };
    for (const t of tokens) s0 = queueRelicStudy(s0, t.id).next;
    expect(s0.activeProcesses.filter((p) => p.kind === "relicStudy")).toHaveLength(1);
    expect(refugeeCarryOf(s0, "relicStudy")).toBeGreaterThan(0);
    const N = 8000;
    const steps = stepped(s0, N);
    const one = economyTick(s0, N, RNG);
    const offline = tick(N, s0, RNG);
    for (const g of [one, offline]) {
      expect(json(g.refugees)).toBe(json(steps.refugees));
      expect(json(g.activeProcesses)).toBe(json(steps.activeProcesses));
      expect(json(g.relicQueue)).toBe(json(steps.relicQueue));
    }
    expect(refugeeCarryOf(steps, "relicStudy")).toBeGreaterThan(0);
    // With the buff off the carry is neither read nor written: the player start's carry stays as it was.
    const plain = withRefugeeBuffsOff(() => stepped(s0, N));
    expect(plain.refugees?.carry).toEqual(s0.refugees?.carry);
    expect(json(steps.refugees?.carry)).not.toBe(json(s0.refugees?.carry));
  });
});


describe("CX-2 (Codex round 7): the research card's duration is the time the project really takes", () => {
  // The card read only the museum and Research Lab speed; startResearch also spends the family's banked data boosts and
  // pays back the Research Lab's carried fraction. researchStartTiming is now the one reader both use.
  const LOW = 20;
  const offMatchPosted = (s: GameState) =>
    withRefugeePosted(s, REFUGEE_BACKGROUND_KEYS.find((b) => REFUGEE_BACKGROUNDS[b].facility !== "research")!, "research", LOW);

  it("matches every start in a chain: museum speed, an off-match Scholar's carry, and banked boosts of the family", () => {
    const ready: GameState = {
      ...refugeeBase(),
      facilities: { ...refugeeBase().facilities, research: { level: 9 } },
      credits: new Decimal(1e15),
    };
    for (const start of [ready, offMatchPosted(ready)]) {
      let s: GameState = start;
      let checked = 0;
      let boostedChecked = 0;
      for (let i = 0; i < 40; i++) {
        const key = Object.keys(BLUEPRINTS).find((k) => canResearch(s, k).ok);
        if (key === undefined) break;
        // Every other start has boosts banked for the blueprint's own family.
        if (i % 2 === 1) s = { ...s, researchBoosts: { [researchFamilyOf(BLUEPRINTS[key])]: 1 + (i % 5) } };
        const shown = researchStartTiming(s, BLUEPRINTS[key], museumBonuses(s).researchSpeed).ticks;
        const r = startResearch(s, key);
        expect(r.started).toBe(true);
        expect(r.next.activeProcesses.at(-1)!.durationTicks).toBe(shown);
        checked++;
        if (i % 2 === 1) boostedChecked++;
        s = { ...r.next, researchedBlueprints: [...(r.next.researchedBlueprints ?? []), key], activeProcesses: [] };
      }
      expect(checked).toBeGreaterThanOrEqual(8);
      expect(boostedChecked).toBeGreaterThanOrEqual(4);
    }
  });

  it("banked boosts make the shown duration shorter, and only for their own family", () => {
    const ready: GameState = { ...refugeeBase(), facilities: { ...refugeeBase().facilities, research: { level: 9 } } };
    const key = Object.keys(BLUEPRINTS).find((k) => canResearch({ ...ready, credits: new Decimal(1e15) }, k).ok && BLUEPRINTS[k].researchDurationTicks >= 60)!;
    const bp = BLUEPRINTS[key];
    const fam = researchFamilyOf(bp);
    const other = RESEARCH_FAMILIES.find((f) => f !== fam)!;
    const speed = museumBonuses(ready).researchSpeed;
    const plain = researchStartTiming(ready, bp, speed).ticks;
    expect(researchStartTiming({ ...ready, researchBoosts: { [fam]: 3 } }, bp, speed).ticks).toBeLessThan(plain);
    expect(researchStartTiming({ ...ready, researchBoosts: { [other]: 3 } }, bp, speed).ticks).toBe(plain);
  });

  it("the research card reads researchStartTiming", () => {
    const app = readFileSync("src/App.svelte", "utf8");
    expect(app).toMatch(/durationReadout\(researchStartTiming\(state, bp, researchMuseumSpeed\)\.ticks/);
    expect(app).not.toMatch(/museumResearchDurationTicks\(bp\.researchDurationTicks/);
  });
});
