// G1-4 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-4): THE CYCLE ENGINE.
// The phases on the frozen plan, the whole job re-rolled at every cycle start (the training run per template, two
// slots training at once), the pay per template, XP per active tick, the departure gate (a drop-off's load paid as it
// leaves; a full Warehouse holds a pickup) idling and resuming on its own, the transit-berth hold, recall (finish the
// cycle; a run still at home ends at once), the completion log entry, the gear wear seam, and offline == live (one
// call == 997 s chunks == 1 s steps) over 20 cycles beside a mission on Repeat and a patrol on Repeat.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type CaptainState, type GameState, type ShortRangeMissionState } from "./model";
import { SHORT_RANGE_TEMPLATES, SHORT_RANGE_TEMPLATE_KEYS, rollShortRangeJob, shortRangeCycleReward, type ShortRangeTemplateKey } from "./shortRange";
import { dispatchCaptainOnShortRange, isWellFormedShortRangeMission, shortRangeBoardSlots, shortRangeNextCycle } from "./shortRangeBoard";
import { shortRangeCycleWear, shortRangeDepartureHold, shortRangeDropOffMargin, shortRangeHasDeparted, shortRangeLoadToPay, tickCaptainShortRange } from "./shortRangeCycle";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, itemCap, mintBuiltShip, recallCaptain } from "./tick";
import { effectiveShipStats, resolveCrew, shipMissionOutputBonus } from "./crewOverlay";
import { runCountsOf, uncountShortRangeCycleStart } from "./runDifficulty";
import { isAwaitingBerth } from "./berths";
import { buildHomeDashboard } from "./homeDashboard";
import { deserialize, migrate, serialize } from "./save";
import { WIRING_CAPTAIN_ID, editShip, heldOf, holding, installPiece, seatOfficer, shipOf, wiringBase } from "./wiring/probes";
// Gear wear step 4 (0.14.0): the parity fleet's Repeat patrol now wears down over its cycles and ends in a defeat
// mid-span; the crew auto-fill then reads the freed ship once per call (crewOverlay.ts resolveCrew), so a 997 s chunk
// and 1 s steps crew it at different instants (production steps one tick). The short-range checks here predate battle
// wear, so the file runs with the battle sources off; gearWearCombat.test.ts proves the wear itself chunk-free.
import { battleWearOffInThisFile } from "./battleWearSwitch.fixture";
battleWearOffInThisFile();

const RNG = (): number => 0.5;

// A crewed Eir with a sensor array: meets the Tier I sheet in every category (shortRangeBoard.test.ts).
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
}

// The first cycle index from `from` whose roll at `slotId` is `template` (the board's own roll, as the counters stand).
function cycleFor(s: GameState, template: ShortRangeTemplateKey, slotId = 0, from = 0): number {
  const slot = shortRangeBoardSlots(s)[slotId];
  for (let i = from; i < from + 2000; i++) if (rollShortRangeJob(s, slot, i).template === template) return i;
  throw new Error(`no ${template} roll`);
}

// Captain `captainId` dispatched on slot `slotId` at the next cycle index that rolls `template`.
function onJob(s: GameState, template: ShortRangeTemplateKey, opts: { slotId?: number; captainId?: number; repeat?: boolean } = {}): GameState {
  const slotId = opts.slotId ?? 0;
  const idx = cycleFor(s, template, slotId);
  const board = { version: 1 as const, nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slotId]: idx } };
  const r = dispatchCaptainOnShortRange({ ...s, shortRangeBoard: board }, opts.captainId ?? WIRING_CAPTAIN_ID, slotId, opts.repeat ?? true);
  expect(r.success, String(r.reason)).toBe(true);
  return r.next;
}

function missionOf(s: GameState, captainId = WIRING_CAPTAIN_ID): ShortRangeMissionState {
  const m = s.captains.find((c) => c.id === captainId)?.mission;
  if (!m || m.kind !== "shortRange") throw new Error("not on a short-range run");
  return m;
}

function withMission(s: GameState, over: Partial<ShortRangeMissionState>, captainId = WIRING_CAPTAIN_ID): GameState {
  return { ...s, captains: s.captains.map((c) => (c.id === captainId ? { ...c, mission: { ...missionOf(s, captainId), ...over } } : c)) };
}

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

// A second captain (id 2) flying a copy of ship-1 (ship-2), so two slots can run at once.
function withSecondCaptain(s: GameState): GameState {
  const c1 = s.captains[0];
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

// What a delivered cycle of `m`'s roll pays in credits on ship-1 (the reward table, then the mission output share).
function expectedCredits(s: GameState, m: ShortRangeMissionState): number {
  const ship = shipOf(s);
  return shortRangeCycleReward(m.roll, effectiveShipStats(s, ship)).credits * (1 + shipMissionOutputBonus(s, ship));
}

// ===== one cycle =====

describe("G1-4 one cycle: the frozen plan's phases, the delivery, and the whole job re-rolled for the next", () => {
  it("transit out, on site, transit back, unloading, each for its planned ticks", () => {
    const s0 = onJob(qualified(), "telescopeRepair");
    const plan = missionOf(s0).plan;
    let s = stepped(s0, plan.transitOutTicks - 1);
    expect(missionOf(s).phase).toBe("transitOut");
    s = stepped(s, 1);
    expect(missionOf(s).phase).toBe("onSite");
    s = stepped(s, plan.onSiteTicks);
    expect(missionOf(s).phase).toBe("transitBack");
    s = stepped(s, plan.transitBackTicks);
    expect(missionOf(s).phase).toBe("unloading");
    s = stepped(s, plan.unloadTicks - 1);
    expect(missionOf(s).phase).toBe("unloading");
    expect(missionOf(s).roll).toEqual(missionOf(s0).roll);
  });

  it("the delivery pays the job, advances the board's cursor and starts the next cycle on a fresh roll", () => {
    const s0 = onJob(qualified(), "telescopeRepair");
    const m0 = missionOf(s0);
    const s = stepped(s0, m0.plan.totalTicks);
    const m1 = missionOf(s);
    expect(Number(s.credits) - Number(s0.credits)).toBeCloseTo(expectedCredits(s0, m0), 6);
    expect(shortRangeNextCycle(s, 0)).toBe(m0.roll.cycleIndex + 1);
    expect(m1.roll.cycleIndex).toBe(m0.roll.cycleIndex + 1);
    // Rolled against the counters as they stood at that start (the delivery counted, the new start not yet).
    const atStart = uncountShortRangeCycleStart(runCountsOf(s), m1.roll.template);
    expect(m1.roll).toEqual(rollShortRangeJob({ ...s0, runCounts: atStart }, shortRangeBoardSlots(s)[0], m0.roll.cycleIndex + 1));
    expect({ phase: m1.phase, phaseProgressTicks: m1.phaseProgressTicks, recalled: m1.recalled, cyclesThisRun: m1.cyclesThisRun }).toEqual({ phase: "transitOut", phaseProgressTicks: 0, recalled: false, cyclesThisRun: 1 });
    // The lifetime tally, keyed per template.
    expect(Number(s.lifetimeStats.missionsCompleted["shortRange:telescopeRepair"])).toBe(1);
  });

  it("captain and Fleet Admiral XP accrue per active tick at the template's integer rates", () => {
    const s0 = onJob(qualified(), "telescopeRepair");
    const m = missionOf(s0);
    const s = stepped(s0, m.plan.totalTicks);
    const rate = SHORT_RANGE_TEMPLATES.telescopeRepair.reward;
    expect(Number(s.lifetimeStats.captainXpAwarded) - Number(s0.lifetimeStats.captainXpAwarded)).toBe(rate.captainXpPerTick[1] * m.plan.totalTicks);
    expect(Number(s.lifetimeStats.fleetAdminXpAwarded) - Number(s0.lifetimeStats.fleetAdminXpAwarded)).toBe(rate.fleetAdminXpPerTick * m.plan.totalTicks);
  });

  it("every template pays what its reward row says (credits net of any load, materials to the Warehouse)", () => {
    for (const template of SHORT_RANGE_TEMPLATE_KEYS) {
      const s0 = onJob(qualified(), template);
      const m = missionOf(s0);
      const s = stepped(s0, m.plan.totalTicks);
      expect(Number(s.credits) - Number(s0.credits), template).toBeCloseTo(expectedCredits(s0, m), 6);
      const base = shortRangeCycleReward(m.roll, effectiveShipStats(s0, shipOf(s0)));
      for (const [item, n] of Object.entries(base.materials)) expect(heldOf(s, item) - heldOf(s0, item), `${template} ${item}`).toBe(n);
      if (template === "supplyPickup") expect(base.materials.commonOre).toBe(m.roll.units);
      if (template === "phenomenonSurvey") expect(Object.keys(base.materials)).toEqual(["rareMaterial"]);
    }
  });

  it("the ship's mission output share (Command Presence) grows the pay", () => {
    const plain = onJob(qualified(), "telescopeRepair");
    const boosted = onJob(seatOfficer(qualified(), "executive", ["xo.commandOutput"]), "telescopeRepair");
    const share = shipMissionOutputBonus(boosted, shipOf(boosted));
    expect(share).toBeGreaterThan(0);
    const gain = (s0: GameState) => Number(stepped(s0, missionOf(s0).plan.totalTicks).credits) - Number(s0.credits);
    expect(gain(boosted)).toBeCloseTo(gain(plain) * (1 + share), 6);
  });
});

// ===== the counters, the training run and the curve =====

describe("G1-4 the counters: a cycle start of each template bumps it, the training run counts nowhere on the curve", () => {
  it("the first cycle of a template is its training run (the smallest roll); its delivery leaves `completed` at 0", () => {
    const s0 = onJob(qualified(), "refugeeRelocation");
    const m = missionOf(s0);
    expect(m.roll.difficulty.firstRun).toBe(true);
    expect(m.roll.guests).toBe(SHORT_RANGE_TEMPLATES.refugeeRelocation.rolls[1].guests![0]);
    expect(runCountsOf(s0).shortRange.refugeeRelocation).toEqual({ dispatched: 1, completed: 0 });
    const s = stepped(s0, m.plan.totalTicks);
    expect(runCountsOf(s).shortRange.refugeeRelocation.completed).toBe(0);
    // The next cycle's start was counted for whatever it drew.
    const next = missionOf(s).roll.template;
    expect(runCountsOf(s).shortRange[next].dispatched).toBe(next === "refugeeRelocation" ? 2 : 1);
  });

  it("a later cycle of the same template is not a training run, and its delivery counts on the curve", () => {
    let s = onJob(qualified(), "refugeeRelocation");
    let guard = 0;
    // Fly until a second refugee cycle starts, then deliver it.
    while (!(missionOf(s).roll.template === "refugeeRelocation" && missionOf(s).roll.cycleIndex > 0 && !missionOf(s).roll.difficulty.firstRun)) {
      s = stepped(s, missionOf(s).plan.totalTicks);
      if (++guard > 200) throw new Error("no second refugee cycle");
    }
    const before = runCountsOf(s).shortRange.refugeeRelocation.completed;
    s = stepped(s, missionOf(s).plan.totalTicks);
    expect(runCountsOf(s).shortRange.refugeeRelocation.completed).toBe(before + 1);
  });

  it("two slots can both start an untried template: both are training runs, neither counts as completed", () => {
    const base = withSecondCaptain(qualified());
    const a = onJob(base, "commBoosterBuild", { slotId: 0, captainId: 1 });
    const two = onJob(a, "commBoosterBuild", { slotId: 1, captainId: 2 });
    // The second dispatch read the counters after the first: not untried any more.
    expect(missionOf(two, 1).roll.difficulty.firstRun).toBe(true);
    expect(missionOf(two, 2).roll.difficulty.firstRun).toBe(false);
    // Both untried at once: dispatch both on states that have not seen the template, then fly.
    const b = onJob(base, "commBoosterBuild", { slotId: 1, captainId: 2 });
    const both = { ...b, captains: [a.captains[0], b.captains[1]], shortRangeBoard: { version: 1 as const, nextCycle: { ...a.shortRangeBoard!.nextCycle, ...b.shortRangeBoard!.nextCycle } } };
    expect(missionOf(both, 1).roll.difficulty.firstRun && missionOf(both, 2).roll.difficulty.firstRun).toBe(true);
    const flown = stepped(both, Math.max(missionOf(both, 1).plan.totalTicks, missionOf(both, 2).plan.totalTicks));
    expect(runCountsOf(flown).shortRange.commBoosterBuild.completed).toBe(0);
  });
});

// ===== the departure gate =====

describe("G1-4 the departure gate: a drop-off pays its load as it leaves; it idles and resumes on its own", () => {
  it("the load is paid at the cycle start and returned with the margin at the delivery", () => {
    const s0 = onJob(qualified(), "supplyDropOff");
    const m = missionOf(s0);
    const load = shortRangeLoadToPay(m.roll, s0.captains[0]);
    const def = SHORT_RANGE_TEMPLATES.supplyDropOff.reward;
    expect(load).toBe(def.kind === "supplyLoop" ? (m.roll.units ?? 0) * def.supplyCostPerUnit[1] : -1);
    expect(load).toBeGreaterThan(0);
    const left = stepped(s0, 1);
    expect(Number(s0.credits) - Number(left.credits)).toBeCloseTo(load, 9);
    expect(missionOf(left).loadPaid).toBe(load);
    const done = stepped(s0, m.plan.totalTicks);
    expect(Number(done.credits) - Number(s0.credits)).toBeCloseTo(expectedCredits(s0, m), 6);
  });

  it("the drop-off margin rounds once after the Trade bonus: no bonus is the reward table's, any bonus never pays less", () => {
    const roll = missionOf(onJob(qualified(), "supplyDropOff")).roll;
    const stats = effectiveShipStats(qualified(), shipOf(qualified()));
    const bonuses = [0, 1e-9, 1e-6, 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1];
    for (let units = 1; units <= 40; units++) {
      const r = { ...roll, units };
      const base = shortRangeCycleReward(r, stats);
      expect(shortRangeDropOffMargin(r, base.loadCost, 0), `units ${units}`).toBe(base.credits);
      let prev = -Infinity;
      for (const bonus of bonuses) {
        const margin = shortRangeDropOffMargin(r, base.loadCost, bonus);
        expect(margin, `units ${units} bonus ${bonus}`).toBeGreaterThanOrEqual(base.credits);
        expect(margin, `units ${units} bonus ${bonus}`).toBeGreaterThanOrEqual(prev);
        expect(Number.isInteger(margin)).toBe(true);
        prev = margin;
      }
    }
    // The case the old split rounding got wrong: a 0.6 credit margin rounds to 1 bare, and a tiny bonus paid 0.6.
    const one = { ...roll, units: 1 };
    const oneBase = shortRangeCycleReward(one, stats);
    expect(oneBase.loadCost * 0.2).toBeCloseTo(0.6, 9);
    expect(shortRangeDropOffMargin(one, oneBase.loadCost, 1e-6)).toBe(1);
    // Every other job has no margin.
    expect(shortRangeDropOffMargin(missionOf(onJob(qualified(), "telescopeRepair")).roll, 100, 0.5)).toBe(0);
  });

  it("with too few credits the cycle waits at home (no progress, no XP, nothing paid), then leaves once it can", () => {
    const s0 = onJob(qualified(), "supplyDropOff");
    const load = shortRangeLoadToPay(missionOf(s0).roll, s0.captains[0]);
    const broke = { ...s0, credits: new Decimal(load - 1) };
    expect(shortRangeDepartureHold(missionOf(broke), broke.captains[0], Number(broke.credits), () => false)).toBe("credits");
    const waited = stepped(broke, 50);
    expect(missionOf(waited)).toEqual(missionOf(broke));
    expect(Number(waited.credits)).toBe(load - 1);
    expect(waited.lifetimeStats.captainXpAwarded).toEqual(broke.lifetimeStats.captainXpAwarded);
    expect(waited.captains[0].lastStopReason).toBeUndefined();
    const funded = stepped({ ...waited, credits: new Decimal(load) }, 1);
    expect(shortRangeHasDeparted(missionOf(funded))).toBe(true);
    expect(Number(funded.credits)).toBeCloseTo(0, 9);
  });

  it("a pickup whose material is at its Warehouse cap waits at home, then leaves once there is room", () => {
    const s0 = onJob(qualified(), "supplyPickup");
    const cap = itemCap(s0, "commonOre");
    const full = holding(s0, "commonOre", cap);
    const waited = stepped(full, 20);
    expect(missionOf(waited)).toEqual(missionOf(full));
    expect(shortRangeDepartureHold(missionOf(waited), waited.captains[0], Number(waited.credits), () => true)).toBe("warehouse");
    const room = stepped({ ...waited, inventory: s0.inventory }, 1);
    expect(missionOf(room).phaseProgressTicks).toBe(1);
  });

  it("an idled roll is never re-drawn: the waiting cycle keeps its roll and the cursor does not move", () => {
    const s0 = onJob(qualified(), "supplyDropOff");
    const broke = { ...s0, credits: new Decimal(0) };
    const waited = stepped(broke, 30);
    expect(missionOf(waited).roll).toEqual(missionOf(s0).roll);
    expect(shortRangeNextCycle(waited, 0)).toBe(shortRangeNextCycle(s0, 0));
  });
});

// ===== the berth hold =====

describe("G1-4 home unload occupies a transit berth on the captain-mission rules (call 18)", () => {
  it("with no berth free the return leg banks and waits; with one it docks", () => {
    const s0 = onJob(qualified(), "telescopeRepair");
    const m = missionOf(s0);
    const banked = withMission(s0, { phase: "transitBack", phaseProgressTicks: m.plan.transitBackTicks - 1 });
    const input = (berths: number) => ({
      ticksElapsed: 2,
      captain: banked.captains[0],
      state: banked,
      ship: shipOf(banked),
      creditsBudget: 1e9,
      berthBudget: berths,
      runCounts: runCountsOf(banked),
      nextCycle: {},
      atCap: () => false,
    });
    const held = tickCaptainShortRange(input(0));
    const heldMission = held.captain.mission as ShortRangeMissionState;
    expect(heldMission.phase).toBe("transitBack");
    expect(heldMission.phaseProgressTicks).toBe(m.plan.transitBackTicks);
    expect(isAwaitingBerth(banked, held.captain)).toBe(true);
    expect(held.berthsClaimed).toBe(0);
    const docked = tickCaptainShortRange(input(1));
    expect((docked.captain.mission as ShortRangeMissionState).phase).toBe("unloading");
    expect(docked.berthsClaimed).toBe(1);
  });

  it("a run that frees its own berth and comes home again in one call takes it back without drawing the shared budget", () => {
    const s0 = onJob(qualified(), "telescopeRepair");
    const unloading = withMission(s0, { phase: "unloading", phaseProgressTicks: 0 });
    const r = tickCaptainShortRange({
      ticksElapsed: 5000,
      captain: unloading.captains[0],
      state: unloading,
      ship: shipOf(unloading),
      creditsBudget: 1e9,
      berthBudget: 0,
      runCounts: runCountsOf(unloading),
      nextCycle: {},
      atCap: () => false,
    });
    expect(r.cyclesDelivered).toBeGreaterThan(2);
    expect(r.berthsClaimed).toBe(0);
  });
});

// ===== recall =====

describe("G1-4 recall: the ship finishes the cycle and stops; a run still at home ends at once", () => {
  it("recalled mid-cycle: it delivers this cycle, then the captain idles; one completion log entry for the run", () => {
    let s = onJob(qualified(), "telescopeRepair");
    s = stepped(s, missionOf(s).plan.totalTicks); // one cycle delivered
    s = stepped(s, 3); // the second cycle under way
    const m = missionOf(s);
    const r = recallCaptain(s, WIRING_CAPTAIN_ID);
    expect(missionOf(r.next).recalled).toBe(true);
    const left = m.plan.totalTicks - 3;
    const almost = stepped(r.next, left - 1);
    expect(missionOf(almost).recalled).toBe(true);
    const done = stepped(almost, 1);
    expect(done.captains[0].mission).toBeNull();
    expect(Number(done.credits) - Number(almost.credits)).toBeCloseTo(expectedCredits(s, m), 6);
    const entry = done.completionLog!.at(-1)!;
    expect(entry).toMatchObject({ kind: "shortRangeRun", iterations: 2, reward: "nothing", subjectKey: "slot-0" });
    const row = buildHomeDashboard(done).recentlyCompleted.find((x) => x.id === entry.id);
    expect(row?.primaryLabel).toBe("Completed, Short-Range Missions");
    expect(row?.secondaryLabel).toBe("2 missions completed, recalled");
  });

  it("recalled before it left home: the run ends now, nothing is paid, and the template keeps its training run", () => {
    const s0 = onJob(qualified(), "supplyDropOff");
    const template = missionOf(s0).roll.template;
    expect(runCountsOf(s0).shortRange[template].dispatched).toBe(1);
    const r = recallCaptain(s0, WIRING_CAPTAIN_ID, 1234);
    expect(r.success).toBe(true);
    expect(r.next.captains[0].mission).toBeNull();
    expect(runCountsOf(r.next).shortRange[template].dispatched).toBe(0);
    expect(r.next.credits.eq(s0.credits)).toBe(true);
    expect(r.next.completionLog!.at(-1)).toMatchObject({ kind: "shortRangeRun", iterations: 0, atMs: 1234 });
    // The next dispatch of the same slot reads the same roll again, still a training run.
    const again = dispatchCaptainOnShortRange(r.next, WIRING_CAPTAIN_ID, 0);
    expect(missionOf(again.next).roll).toEqual(missionOf(s0).roll);
  });

  it("repeat off flies exactly one cycle", () => {
    const s0 = onJob(qualified(), "telescopeRepair", { repeat: false });
    const done = stepped(s0, missionOf(s0).plan.totalTicks);
    expect(done.captains[0].mission).toBeNull();
    expect(done.completionLog!.at(-1)).toMatchObject({ kind: "shortRangeRun", iterations: 1 });
  });

  it("a one-cycle drop-off that cannot pay yet waits at home and flies when it can (it is never cancelled by the gate)", () => {
    const s0 = onJob(qualified(), "supplyDropOff", { repeat: false });
    const broke = stepped({ ...s0, credits: new Decimal(0) }, 10);
    expect(missionOf(broke).recalled).toBe(true);
    expect(shortRangeHasDeparted(missionOf(broke))).toBe(false);
    const flown = stepped({ ...broke, credits: new Decimal(1e6) }, missionOf(broke).plan.totalTicks);
    expect(flown.captains[0].mission).toBeNull();
  });
});

// ===== offline == live =====

// The parity fleet: captain 1's crewed Eir on short-range slot 0 (Repeat), captain 2 a General Freighter on a Long Ore
// Run (Repeat), captain 3 a Destroyer on a patrol (Repeat); every berth rung bought so no unload ever waits.
function parityFleet(): GameState {
  const base = { ...qualified(), transitBerthCapacity: 8 };
  let acc = { ships: base.ships, nextShipId: base.nextShipId, equipment: base.equipment, nextEquipmentId: base.nextEquipmentId };
  const freighter = mintBuiltShip(acc, "generalFreighter");
  acc = freighter;
  const destroyer = mintBuiltShip(acc, "destroyer");
  const owner: Record<string, number> = { [freighter.shipId]: 2, [destroyer.shipId]: 3 };
  const c1 = base.captains[0];
  const fleet: GameState = installMissingCombatBaselines({
    ...base,
    ships: destroyer.ships.map((sh) => (owner[sh.id] === undefined ? sh : { ...sh, assignedCaptainId: owner[sh.id] })),
    nextShipId: destroyer.nextShipId,
    equipment: destroyer.equipment,
    nextEquipmentId: destroyer.nextEquipmentId,
    facilities: { ...base.facilities, missionControl: { ...base.facilities.missionControl, level: 9 } },
    captains: [{ ...c1, level: 10 }, { ...c1, id: 2, label: "Second", level: 10, mission: null }, { ...c1, id: 3, label: "Third", level: 10, mission: null }],
  });
  const sr = dispatchCaptainOnShortRange(fleet, 1, 0);
  expect(sr.success, String(sr.reason)).toBe(true);
  const mission = dispatchCaptainOnMission(sr.next, 2, "longOreRun");
  expect(mission.success, String(mission.reason)).toBe(true);
  const patrol = dispatchCaptainOnPatrol(mission.next, 3, "crimsonReaverSweep", "balanced", true);
  expect(patrol.success, String(patrol.reason)).toBe(true);
  return patrol.next;
}

// Whole-state equality, field by field, through the save's JSON with object keys sorted and the `discovered` set sorted
// (one call folds every delivery at its end in key order, so a mission's and a patrol's deliveries can first add an
// inventory key, and reveal it, in either order when the span is cut differently; the values are equal).
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
function same(a: GameState, b: GameState): void {
  const ja = canonical(JSON.parse(JSON.stringify({ ...a, discovered: [...a.discovered].sort() }))) as Record<string, unknown>;
  const jb = canonical(JSON.parse(JSON.stringify({ ...b, discovered: [...b.discovered].sort() }))) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) expect(JSON.stringify(ja[k]), k).toBe(JSON.stringify(jb[k]));
}

describe("G1-4 offline == live: one call == 997 s chunks == 1 s steps over 20 cycles beside a mission and a patrol", () => {
  it("the whole state matches every way the span is cut", () => {
    const s0 = parityFleet();
    // Long enough for 20 short-range cycles (each about a hundred ticks at Tier I).
    const N = 2400;
    const once = economyTick(s0, N, RNG);
    let chunks = s0;
    for (let left = N; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), RNG);
    const steps = stepped(s0, N);
    expect(Number(once.lifetimeStats.missionsCompleted["longOreRun"] ?? 0)).toBeGreaterThan(0);
    const delivered = Object.entries(once.lifetimeStats.missionsCompleted).filter(([k]) => k.startsWith("shortRange:")).reduce((n, [, v]) => n + Number(v), 0);
    expect(delivered).toBeGreaterThanOrEqual(20);
    // 997 s chunks against 1 s steps: the WHOLE state, the mission and the patrol included.
    same(chunks, steps);
    // One 2,400 s call: the short-range run, its counters, its board, its log and the patrol match the steps exactly.
    // The Long Ore Run is left out of this one comparison for its own pre-existing reason: an extraction draws its
    // berths from a per-call budget (tick.ts, 0.13.4), so a single call longer than ten of its cycles holds it at a
    // berth, which production never does (live and offline both step economyTick(state, 1)).
    const view = (g: GameState) => ({
      shortRange: g.captains.find((c) => c.id === 1),
      patrol: g.captains.find((c) => c.id === 3),
      runCounts: g.runCounts,
      board: g.shortRangeBoard,
      log: g.completionLog,
      warehouseIridium: heldOf(g, "rareMaterial"),
    });
    expect(JSON.stringify(view(once))).toBe(JSON.stringify(view(steps)));
  });

  it("alone, the whole state matches for one call, 997 s chunks and 1 s steps (every job, the drop-off's load included)", () => {
    const s0 = onJob(qualified(), "supplyDropOff");
    const N = 2400;
    const once = economyTick(s0, N, RNG);
    let chunks = s0;
    for (let left = N; left > 0; left -= 997) chunks = economyTick(chunks, Math.min(997, left), RNG);
    const steps = stepped(s0, N);
    const templates = new Set(Object.keys(steps.lifetimeStats.missionsCompleted).filter((k) => k.startsWith("shortRange:")));
    expect(templates.size).toBe(SHORT_RANGE_TEMPLATE_KEYS.length);
    same(once, steps);
    same(chunks, steps);
  });
});

// ===== the gear wear seam and the save =====

describe("G1-4 the gear wear seam (W9) and the save", () => {
  it("no wear on a training run; a regular cycle reports its haul, distance, time underway and survey", () => {
    const s0 = onJob(qualified(), "supplyPickup");
    const m = missionOf(s0);
    expect(shortRangeCycleWear(m.roll, m.plan, 1)).toBeNull();
    const regular = { ...m.roll, difficulty: { ...m.roll.difficulty, firstRun: false } };
    expect(shortRangeCycleWear(regular, m.plan, 1)).toEqual({ hauls: 1, lightYears: m.roll.distanceLy * 2, minutesUnderway: m.plan.totalTicks / 60, surveys: 0 });
  });

  it("a run mid-cycle with its paid load and cycle count round-trips; a bad load is refused at load", () => {
    let s = onJob(qualified(), "supplyDropOff");
    s = stepped(s, 2);
    expect(missionOf(s).loadPaid).toBeGreaterThan(0);
    const back = migrate(deserialize(serialize(withMission(s, { cyclesThisRun: 3 }), 0, 0))!);
    expect(missionOf(back)).toEqual({ ...missionOf(s), cyclesThisRun: 3 });
    expect(isWellFormedShortRangeMission({ ...missionOf(s), loadPaid: -1 })).toBe(false);
    expect(isWellFormedShortRangeMission({ ...missionOf(s), cyclesThisRun: 1.5 })).toBe(false);
  });
});
