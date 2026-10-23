// G1-3 (Short-Range Missions, docs/plans/2026-10-17-short-range-missions-plan.md section 4 G1-3): the board, the
// dispatch gate (one reason per short category plus the captain-mission reasons and the crew lock), dispatch with its
// per-template cycle-start bookkeeping, recall after the current cycle, the widened mission union at every consumer
// (crew lock, salvage, ship assignment, berths, roster, Home, the economy tick) and save hydration hardening.

import { describe, expect, it, vi } from "vitest";
import {
  FACILITIES,
  MISSION_CONTROL_BOARD_RUNGS,
  MISSION_CONTROL_UNLOCK_COMPLETIONS,
  SHORT_RANGE_BOARD_LIVE,
  type CaptainState,
  type Expedition,
  type GameState,
  type MissionKind,
  type ShortRangeMissionState,
} from "./model";
import {
  SHORT_RANGE_CATEGORIES,
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  meetsSheet,
  rollShortRangeJob,
  shortRangeCyclePlan,
  shortRangeShipEngineering,
  type ShortRangeTemplateKey,
} from "./shortRange";
import {
  SHORT_RANGE_BASE_SLOT_TIERS,
  canDispatchShortRange,
  dispatchCaptainOnShortRange,
  isWellFormedShortRangeBoard,
  isWellFormedShortRangeMission,
  setShortRangeRepeat,
  shortRangeBlockText,
  shortRangeBoardSlots,
  shortRangeMissionLabel,
  shortRangeNextCycle,
  shortRangeSlotOccupant,
  shortRangeSlotPreview,
  startShortRangeCycle,
  type ShortRangeDispatchBlockReason,
} from "./shortRangeBoard";
import { assignShipToCaptain, economyTick, recallCaptain, shipsOutOnRuns } from "./tick";
import { effectiveShipStats, resolveCrew } from "./crewOverlay";
import { crewLockReason, shipCrewLocked } from "./crewLock";
import { salvageShipLockReason } from "./salvage";
import { isAwaitingBerth, missionPhaseStatus, transitBerthCount, transitBerthsOccupied } from "./berths";
import { buildShipRoster } from "./shipRoster";
import { buildHomeDashboard } from "./homeDashboard";
import { deserialize, migrate, serialize } from "./save";
import { countShortRangeCycleStart, isFirstRun, runCountsOf } from "./runDifficulty";
import { PROBES, WIRING_CAPTAIN_ID, captainOf, editShip, installPiece, shipOf, wiringBase } from "./wiring/probes";

// ===== fixtures =====

// A crewed Eir with a sensor array: meets the Tier I sheet in every category (shortRange.test.ts G1-2).
function qualified(): GameState {
  const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
  return installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
}

function withMissionControl(s: GameState, level: number): GameState {
  return { ...s, facilities: { ...s.facilities, missionControl: { level } } };
}

// A second captain (id 2) flying a copy of ship-1 (ship-2), so two slots can run at once.
function withSecondCaptain(s: GameState): GameState {
  const c1 = captainOf(s);
  const c2: CaptainState = { ...c1, id: 2, label: "Captain 2", mission: null };
  const ship2 = { ...shipOf(s), id: "ship-2", assignedCaptainId: 2 };
  const gear2 = s.equipment.filter((e) => e.fittedToShipId === "ship-1").map((e) => ({ ...e, id: `${e.id}-2`, fittedToShipId: "ship-2" }));
  return { ...s, captains: [...s.captains, c2], ships: [...s.ships, ship2], equipment: [...s.equipment, ...gear2] };
}

function missionOf(s: GameState, captainId: number = WIRING_CAPTAIN_ID): ShortRangeMissionState {
  const m = s.captains.find((c) => c.id === captainId)?.mission;
  if (!m || m.kind !== "shortRange") throw new Error("not on a short-range run");
  return m;
}

function withMission(s: GameState, over: Partial<ShortRangeMissionState>): GameState {
  const m = { ...missionOf(s), ...over };
  return { ...s, captains: s.captains.map((c) => (c.id === WIRING_CAPTAIN_ID ? { ...c, mission: m } : c)) };
}

function dispatched(s: GameState = qualified(), slotId = 0, repeat = true): GameState {
  const r = dispatchCaptainOnShortRange(s, WIRING_CAPTAIN_ID, slotId, repeat);
  expect(r.success).toBe(true);
  return r.next;
}

// ===== the board =====

describe("G1-3 board: slots from Mission Control upgrades (call 8)", () => {
  it("two Tier I slots from the start", () => {
    const s = wiringBase();
    expect(s.facilities.missionControl.level).toBe(1);
    expect(SHORT_RANGE_BASE_SLOT_TIERS).toEqual([1, 1]);
    expect(shortRangeBoardSlots(s)).toEqual([
      { id: 0, tier: 1 },
      { id: 1, tier: 1 },
    ]);
  });

  it("a Tier II slot at Mission Control level 2, a fourth at level 3; ids are stable board positions", () => {
    expect(shortRangeBoardSlots(withMissionControl(wiringBase(), 2))).toEqual([
      { id: 0, tier: 1 },
      { id: 1, tier: 1 },
      { id: 2, tier: 2 },
    ]);
    expect(shortRangeBoardSlots(withMissionControl(wiringBase(), 3))).toEqual([
      { id: 0, tier: 1 },
      { id: 1, tier: 1 },
      { id: 2, tier: 2 },
      { id: 3, tier: 2 },
    ]);
    // A level past the track opens nothing more; a missing or malformed level opens only the base slots.
    expect(shortRangeBoardSlots(withMissionControl(wiringBase(), 9))).toHaveLength(4);
    expect(shortRangeBoardSlots(withMissionControl(wiringBase(), Number.NaN))).toHaveLength(2);
    expect(shortRangeBoardSlots({ facilities: {} })).toHaveLength(2);
  });

  it("the level 1 -> 2 rung is the kept 50-completion hook; G1-6 put the rungs in FACILITIES with the board", () => {
    expect(MISSION_CONTROL_BOARD_RUNGS).toHaveLength(2);
    expect(MISSION_CONTROL_BOARD_RUNGS[0].requiresMissionCompletions).toEqual({
      shortOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
      longOreRun: MISSION_CONTROL_UNLOCK_COMPLETIONS,
    });
    expect(MISSION_CONTROL_BOARD_RUNGS.map((r) => r.effect)).toEqual([{ addShortRangeSlot: 2 }, { addShortRangeSlot: 2 }]);
    expect(SHORT_RANGE_BOARD_LIVE).toBe(true);
    // The founding rung, then both board rungs: the slots a player can build are the slots the board shows.
    expect(FACILITIES.missionControl.upgrades.slice(1)).toEqual([...MISSION_CONTROL_BOARD_RUNGS]);
  });

  it("the wiring probe reads the slot count (the registry's rung entries use it once the rungs are live)", () => {
    const read = PROBES.shortRangeSlots.read;
    expect(read(withMissionControl(wiringBase(), 1))).toBe(2);
    expect(read(withMissionControl(wiringBase(), 2))).toBe(3);
  });

  it("the cycle cursor: absent or malformed reads as cycle 0; a stored one is read per slot", () => {
    const s = wiringBase();
    expect(shortRangeNextCycle(s, 0)).toBe(0);
    const stored: GameState = { ...s, shortRangeBoard: { version: 1, nextCycle: { 1: 7 } } };
    expect(shortRangeNextCycle(stored, 1)).toBe(7);
    expect(shortRangeNextCycle(stored, 0)).toBe(0);
    for (const bad of [null, 3, { version: 2, nextCycle: {} }, { version: 1, nextCycle: { 0: -1 } }, { version: 1, nextCycle: { 0: 1.5 } }, { version: 1, nextCycle: [1] }]) {
      expect(isWellFormedShortRangeBoard(bad)).toBe(false);
      expect(shortRangeNextCycle({ shortRangeBoard: bad as never }, 0)).toBe(0);
    }
  });

  it("a free slot previews its next roll; the preview is the roll dispatch takes", () => {
    const s = qualified();
    const slot = shortRangeBoardSlots(s)[0];
    const preview = shortRangeSlotPreview(s, slot);
    expect(preview).toEqual(rollShortRangeJob(s, slot, 0));
    expect(missionOf(dispatched(s, 0)).roll).toEqual(preview);
  });
});

// ===== the gate =====

describe("G1-3 dispatch gate: the captain-mission reasons, the crew lock, one reason per short category", () => {
  function refused(s: GameState, slotId: number, captainId = WIRING_CAPTAIN_ID) {
    const gate = canDispatchShortRange(s, captainId, slotId);
    const r = dispatchCaptainOnShortRange(s, captainId, slotId);
    expect(r.success).toBe(false);
    expect(r.next).toBe(s); // same ref on refusal
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("unreachable");
    expect(r.reason).toBe(gate.reason);
    expect(r.short).toEqual(gate.short);
    return gate;
  }

  it("a qualified ship passes", () => {
    expect(canDispatchShortRange(qualified(), WIRING_CAPTAIN_ID, 0)).toEqual({ ok: true });
  });

  it("noCaptain, noSlot (a Tier II slot before Mission Control 2), busy, slotTaken", () => {
    const s = qualified();
    expect(refused(s, 0, 99).reason).toBe("noCaptain");
    expect(refused(s, 2).reason).toBe("noSlot");
    expect(refused(s, -1).reason).toBe("noSlot");
    const flying = dispatched(s, 0);
    expect(refused(flying, 1).reason).toBe("busy");
    const two = dispatched(withSecondCaptain(s), 0);
    expect(refused(two, 0, 2).reason).toBe("slotTaken");
    expect(canDispatchShortRange(two, 2, 1)).toEqual({ ok: true });
  });

  it("noShip, needsRepair, crewLocked (the ship is on an expedition)", () => {
    const s = qualified();
    expect(refused(editShip(s, { assignedCaptainId: null }), 0).reason).toBe("noShip");
    expect(refused(editShip(s, { damaged: true }), 0).reason).toBe("needsRepair");
    const out: GameState = { ...s, expeditions: [{ shipId: "ship-1", phase: "transitOut" } as unknown as Expedition] };
    expect(crewLockReason(out, "ship-1")).toBe("onExpedition");
    expect(refused(out, 0).reason).toBe("crewLocked");
  });

  it("the sheet: every short category is named, in order; the reason is the first", () => {
    const bare = wiringBase();
    const gate = refused(bare, 0);
    expect(gate.short).toEqual(meetsSheet(bare, shipOf(bare), 1).short);
    expect(gate.short).toEqual(["guests", "sensors", "engineering", "security"]);
    expect(gate.reason).toBe("guests");
    // A qualified Tier I ship on the Tier II slot: Tier II's bigger sheet, Range first.
    const s = withMissionControl(qualified(), 2);
    const t2 = refused(s, 2);
    expect(t2.short).toEqual(meetsSheet(s, shipOf(s), 2).short);
    expect(t2.reason).toBe(t2.short[0]);
    expect(t2.short.length).toBeGreaterThan(0);
  });

  it("each category's reason has its own text; every reason has text", () => {
    const reasons: ShortRangeDispatchBlockReason[] = ["noCaptain", "noSlot", "busy", "slotTaken", "noShip", "needsRepair", "crewLocked", ...SHORT_RANGE_CATEGORIES];
    const texts = reasons.map(shortRangeBlockText);
    expect(new Set(texts).size).toBe(reasons.length);
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(0);
      expect(t).not.toMatch(/—|-{2}/); // the text rules: no em dash, no double hyphen
    }
    expect(shortRangeBlockText("guests")).toBe("Not enough guest quarters for this slot");
  });
});

// ===== dispatch =====

describe("G1-3 dispatch: the first cycle start, frozen, and the per-template bookkeeping", () => {
  it("seeds the run at the slot's next cycle: the roll, its frozen plan, the outbound leg", () => {
    const s = qualified();
    const next = dispatched(s, 0);
    const m = missionOf(next);
    const slot = shortRangeBoardSlots(s)[0];
    const ship = shipOf(s);
    expect(m.kind).toBe("shortRange");
    expect(m.slotId).toBe(0);
    expect(m.roll).toEqual(rollShortRangeJob(s, slot, 0));
    expect(m.plan).toEqual(shortRangeCyclePlan(m.roll, effectiveShipStats(s, ship), shortRangeShipEngineering(s, ship)));
    expect(m.phase).toBe("transitOut");
    expect(m.phaseProgressTicks).toBe(0);
    expect(m.recalled).toBe(false);
    expect(m.speed).toBeUndefined();
    expect(shortRangeSlotOccupant(next, 0)?.id).toBe(WIRING_CAPTAIN_ID);
    expect(shortRangeSlotOccupant(next, 1)).toBeNull();
  });

  it("reads the stored cycle cursor (a delivered slot rolls its next cycle)", () => {
    const s: GameState = { ...qualified(), shortRangeBoard: { version: 1, nextCycle: { 0: 4 } } };
    const m = missionOf(dispatched(s, 0));
    expect(m.roll.cycleIndex).toBe(4);
    expect(m.roll).toEqual(rollShortRangeJob(s, shortRangeBoardSlots(s)[0], 4));
  });

  it("the first cycle of an untried template is its training run; the cycle start counts it (dispatched + 1)", () => {
    const s = qualified();
    const m = missionOf(dispatched(s, 0));
    expect(isFirstRun(s, "shortRange", m.roll.template)).toBe(true);
    expect(m.roll.difficulty.firstRun).toBe(true);
    const next = dispatched(s, 0);
    expect(runCountsOf(next).shortRange[m.roll.template]).toEqual({ dispatched: 1, completed: 0 });
    // Only the drawn template counts; every other template is untouched.
    for (const k of SHORT_RANGE_TEMPLATE_KEYS) if (k !== m.roll.template) expect(runCountsOf(next).shortRange[k]).toBeUndefined();
    expect(isFirstRun(next, "shortRange", m.roll.template)).toBe(false);
  });

  it("a template already started is not a training run; two slots can each start an untried template", () => {
    const base = withSecondCaptain(qualified());
    const template = rollShortRangeJob(base, { id: 0, tier: 1 }, 0).template;
    // Pre-count the template slot 0 draws: its roll is now a regular one.
    const counted: GameState = { ...base, runCounts: countShortRangeCycleStart(runCountsOf(base), template) };
    expect(missionOf(dispatched(counted, 0)).roll.difficulty.firstRun).toBe(false);
    // Fresh counters: slot 0 and slot 1 both start (each reads the counters at its own start).
    const one = dispatched(base, 0);
    const two = dispatchCaptainOnShortRange(one, 2, 1);
    expect(two.success).toBe(true);
    const a = missionOf(two.next, WIRING_CAPTAIN_ID).roll;
    const b = missionOf(two.next, 2).roll;
    expect(b.difficulty.firstRun).toBe(isFirstRun(one, "shortRange", b.template));
    const total = SHORT_RANGE_TEMPLATE_KEYS.reduce((n, k) => n + (runCountsOf(two.next).shortRange[k]?.dispatched ?? 0), 0);
    expect(total).toBe(2);
    if (a.template !== b.template) expect(b.difficulty.firstRun).toBe(true);
  });

  it("startShortRangeCycle is the dispatch's own cycle start (the seam G1-4 reuses)", () => {
    const s = qualified();
    const slot = shortRangeBoardSlots(s)[1];
    const start = startShortRangeCycle(s, shipOf(s), slot, 3, undefined, true);
    const m = missionOf(dispatched({ ...s, shortRangeBoard: { version: 1, nextCycle: { 1: 3 } } }, 1));
    expect(m.roll).toEqual(start.roll);
    expect(m.plan).toEqual(start.plan);
    expect(start.runCounts.shortRange[start.roll.template]?.dispatched).toBe(1);
  });

  it("clears a stale wall-stop reason; repeat false flies one cycle (starts recalled); spends nothing", () => {
    const s = { ...qualified(), captains: qualified().captains.map((c) => ({ ...c, lastStopReason: "cargo" as const })) };
    const next = dispatched(s, 0, false);
    expect(captainOf(next).lastStopReason).toBeUndefined();
    expect(missionOf(next).recalled).toBe(true);
    expect(next.credits.eq(s.credits)).toBe(true);
    expect(next.inventory).toBe(s.inventory);
  });

  it("the run's label is its current job", () => {
    const m = missionOf(dispatched());
    expect(shortRangeMissionLabel(m)).toBe(SHORT_RANGE_TEMPLATES[m.roll.template].label);
  });
});

// ===== recall =====

describe("G1-3 recall: finishes the current cycle, then stops", () => {
  it("flags the run and leaves the phase and progress alone, in every phase", () => {
    const base = dispatched();
    for (const phase of ["transitOut", "onSite", "transitBack", "unloading"] as const) {
      const s = withMission(base, { phase, phaseProgressTicks: 2 });
      const r = recallCaptain(s, WIRING_CAPTAIN_ID);
      expect(r.success).toBe(true);
      expect(missionOf(r.next)).toEqual({ ...missionOf(s), recalled: true });
    }
  });
});

// ===== the Repeat toggle (G1-6) =====

describe("G1-6 the Repeat toggle: off finishes this cycle, on takes it back; never ends a run at home", () => {
  it("off flags the run like a single run; on clears it; nothing else moves", () => {
    const s = withMission(dispatched(), { phase: "onSite", phaseProgressTicks: 3 });
    const off = setShortRangeRepeat(s, WIRING_CAPTAIN_ID, false);
    expect(off.success).toBe(true);
    expect(missionOf(off.next)).toEqual({ ...missionOf(s), recalled: true });
    const on = setShortRangeRepeat(off.next, WIRING_CAPTAIN_ID, true);
    expect(on.success).toBe(true);
    expect(missionOf(on.next)).toEqual(missionOf(s));
  });

  it("a run still at home set to stop keeps its cycle (unlike Recall, which ends it at once)", () => {
    const s = dispatched();
    const off = setShortRangeRepeat(s, WIRING_CAPTAIN_ID, false);
    expect(off.success).toBe(true);
    expect(missionOf(off.next).phase).toBe("transitOut");
    expect(off.next.runCounts).toBe(s.runCounts);
  });

  it("the same setting, an idle captain or an unknown captain returns the SAME state", () => {
    const s = dispatched();
    expect(setShortRangeRepeat(s, WIRING_CAPTAIN_ID, true)).toEqual({ next: s, success: false });
    expect(setShortRangeRepeat(s, WIRING_CAPTAIN_ID, true).next).toBe(s);
    const idle = qualified();
    expect(setShortRangeRepeat(idle, WIRING_CAPTAIN_ID, false).next).toBe(idle);
    expect(setShortRangeRepeat(s, 999, false).next).toBe(s);
  });
});

// ===== the union at its consumers =====

describe("G1-3 the widened mission union at every consumer", () => {
  it("exhaustive over the kinds (a new kind is a compile error here)", () => {
    const label = (k: MissionKind): string => {
      switch (k) {
        case "extraction":
          return "gathering";
        case "patrol":
          return "patrol";
        case "shortRange":
          return "shortRange";
        default: {
          const never: never = k;
          return never;
        }
      }
    };
    expect(label("shortRange")).toBe("shortRange");
  });

  it("the ship is out: crew lock, gear lock, salvage lock, ship swap refused, a run counter ship", () => {
    const s = dispatched();
    expect(shipCrewLocked(s, "ship-1")).toBe(true);
    expect(crewLockReason(s, "ship-1")).toBe("onShortRange"); // S2: the honest reason (a short-range run)
    expect(salvageShipLockReason(s, "ship-1")).toBe("shipOnMission");
    const parked = { ...s, ships: [...s.ships, { ...shipOf(s), id: "ship-9", assignedCaptainId: null }] };
    const swap = assignShipToCaptain(parked, WIRING_CAPTAIN_ID, "ship-9");
    expect(swap.success).toBe(false);
    expect(swap.next).toBe(parked);
    expect(shipsOutOnRuns(s).has("ship-1")).toBe(true);
  });

  it("home unload occupies a transit berth on the captain-mission rules (call 18); a banked return leg waits", () => {
    const s = dispatched();
    const m = missionOf(s);
    expect(transitBerthsOccupied(s)).toBe(0);
    const unloading = withMission(s, { phase: "unloading", phaseProgressTicks: 0 });
    expect(transitBerthsOccupied(unloading)).toBe(1);
    const banked = withMission(s, { phase: "transitBack", phaseProgressTicks: m.plan.transitBackTicks });
    expect(isAwaitingBerth(banked, captainOf(banked))).toBe(true);
    expect(isAwaitingBerth(withMission(s, { phase: "transitBack", phaseProgressTicks: m.plan.transitBackTicks - 1 }), captainOf(s))).toBe(false);
    // A free berth: a banked leg reads as an ordinary return; the phase vocabulary is the short-range one.
    expect(transitBerthCount(banked)).toBeGreaterThan(0);
    expect(missionPhaseStatus(banked, captainOf(banked))).toBe("Transiting Back");
    expect(missionPhaseStatus(withMission(s, { phase: "onSite" }), captainOf(withMission(s, { phase: "onSite" })))).toBe("On Site");
  });

  it("the Ships roster buckets it as a short-range run; Home lists it in progress", () => {
    const s = dispatched();
    const row = buildShipRoster(s, { sortKey: "status", filterKey: "all", searchText: "", favorites: new Set() })
      .groups.flatMap((g) => g.rows)
      .find((r) => r.id === "ship-1");
    expect(row?.status).toBe("shortRange");
    const home = buildHomeDashboard(s);
    const r = home.inProgress.find((x) => x.id === `shortRange-${WIRING_CAPTAIN_ID}`);
    expect(r?.kind).toBe("shortRange");
    expect(r?.primaryLabel).toContain(shortRangeMissionLabel(missionOf(s)));
    expect(r?.durationTicks).toBe(missionOf(s).plan.transitOutTicks);
  });

  // G1-4 replaced the hold-still arm with the cycle engine (shortRangeCycle.test.ts covers it in full).
  it("the economy tick advances a short-range run through the cycle engine (G1-4)", () => {
    const s = dispatched();
    const next = economyTick(s, 10);
    // (A drop-off also records the load it paid as it left: loadPaid.)
    const { loadPaid: _paid, ...moved } = missionOf(next);
    expect(moved).toEqual({ ...missionOf(s), phaseProgressTicks: 10 });
  });
});

// ===== save =====

describe("G1-3 save: optional fields only; a bad run or board loads safely", () => {
  function roundTrip(s: GameState): GameState {
    const save = deserialize(serialize(s, 0, 0));
    if (save === null) throw new Error("no save");
    return migrate(save);
  }

  it("a short-range run and the board round-trip unchanged", () => {
    const s: GameState = { ...dispatched(), shortRangeBoard: { version: 1, nextCycle: { 0: 2 } } };
    const back = roundTrip(s);
    expect(missionOf(back)).toEqual(missionOf(s));
    expect(back.shortRangeBoard).toEqual(s.shortRangeBoard);
    expect(isWellFormedShortRangeMission(missionOf(s))).toBe(true);
  });

  it("a hand-edited bad roll ends the run at load (the captain idles, no reward), never a crash", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = dispatched();
    const bad: Array<Partial<ShortRangeMissionState> | Record<string, unknown>> = [
      { roll: { ...missionOf(base).roll, template: "retiredJob" as ShortRangeTemplateKey } },
      { roll: { ...missionOf(base).roll, tier: 3 as never } },
      { roll: undefined as never },
      { plan: { ...missionOf(base).plan, unloadTicks: Number.NaN } },
      { phase: "warping" as never },
      { slotId: -1 },
    ];
    for (const over of bad) {
      const s = withMission(base, over as Partial<ShortRangeMissionState>);
      expect(isWellFormedShortRangeMission(missionOf(s))).toBe(false);
      const back = roundTrip(s);
      expect(captainOf(back).mission).toBeNull();
      expect(back.credits.eq(s.credits)).toBe(true);
      expect(() => economyTick(back, 5)).not.toThrow();
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a malformed board is dropped at load; a save without one gains no key", () => {
    const s = { ...wiringBase(), shortRangeBoard: { version: 1, nextCycle: { 0: "x" } } } as unknown as GameState;
    expect("shortRangeBoard" in roundTrip(s)).toBe(false);
    expect("shortRangeBoard" in roundTrip(wiringBase())).toBe(false);
  });
});
