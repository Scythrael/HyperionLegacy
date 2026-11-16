// 0.14.0: THE PROCESS SPEED SEAM (processSpeed.ts) and the GRANT hook. Design: docs/plans/2026-10-16-credit-sinks-pass.md
// "SPEED SEAM DESIGN". User decisions: docs/plans/2026-10-15-safe-first-runs-plan.md "USER ANSWERS, group 2: tutorial
// hooks" (a time skip on every timed process; a grant hook) and the credit sinks doc's USER ANSWERS (Overtime: +25% of
// the normal rate per step, a few steps max, each step costlier, never doubling, never instant).
//
// What is proven here, per process type:
//   - Overtime moves a running job's completion to exactly the tick its remaining work at the faster rate implies,
//     whether the span is stepped one tick at a time or caught up in one call (offline == live), with no draws;
//   - the time skip finishes every timed process for free: a timed process on the next tick, a mission cycle or a
//     patrol route through to its end on the next tick (the same haul the time would have produced), an expedition at
//     once (the same findings the run would have produced);
//   - the grant hook adds credits, items, uninspected gear and a hull, with a log line, atomically;
//   - nothing changes when no modifier is present (the whole suite's goldens prove the rest).

import { describe, it, expect, vi, afterEach } from "vitest";
import Decimal from "break_infinity.js";
import {
  BLUEPRINTS,
  PATROLS,
  SHIP_TYPES,
  freshState,
  type AwayMember,
  type Expedition,
  type GameState,
  type ProcessEffect,
  type RelicVaultToken,
  type ShipTypeKey,
  type TimedProcess,
  type TimedProcessKind,
  generalMuseumRecord,
} from "./model";
import { dispatchCaptainOnMission, dispatchCaptainOnPatrol, economyTick, installMissingCombatBaselines, itemCap, recallCaptain, startProcess, tick } from "./tick";
import { itemTotal } from "./inventory";
import { buildHomeDashboard } from "./homeDashboard";
import { RELIC_SETS } from "./relics";
import { advanceExpedition, claimExpedition, expeditionCandidates } from "./expedition";
import { applyGroundOpsInjuries } from "./injuries";
import { dispatchCaptainOnShortRange } from "./shortRangeBoard";
import { resolveCrew } from "./crewOverlay";
import { editShip, installPiece, wiringBase, withRunningJobs } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";
import { OTUI_RESTATED_ID, otUiReadBack } from "./otUiRegistry.fixture";
import { withNeverDiscardOff } from "./neverDiscardSwitch.fixture";
import { asPreCurveDispatch, ensureMinimumAwayTeam, plainAwayMember, withSlottedAwayTeams, dispatchPastPropulsion } from "./awayTeamTestFixtures";
import {
  OVERTIME_CREDITS_PER_MINUTE,
  OVERTIME_MAX_STEPS,
  OVERTIME_PROCESS_KINDS,
  OVERTIME_STEP_RATE,
  applyTimeSkip,
  buyOvertime,
  canApplyTimeSkip,
  canBuyOvertime,
  canGrant,
  grant,
  overtimeRate,
  overtimeStepCost,
  overtimeTier,
  processRate,
  processWorkFraction,
  type ProcessRef,
} from "./processSpeed";

const RNG = () => 0.5;
const JOB_TICKS = 1000;

afterEach(() => vi.restoreAllMocks());

function rich(s: GameState = freshState()): GameState {
  return { ...s, credits: new Decimal(1_000_000) };
}

// One timed process of each kind, started through the shared startProcess engine with an effect its completion can
// apply on a fresh save (the effect shapes are the real ones; the start gates are covered by each system's own tests).
function effectFor(kind: TimedProcessKind): ProcessEffect {
  switch (kind) {
    case "refineJob":
    case "fuelRefineJob":
      return { type: "addItem", itemId: "frameSegment", amount: new Decimal(2) };
    case "facilityUpgrade":
      return { type: "facilityLevelUp", facility: "refinery" };
    case "researchProject":
      return { type: "unlockBlueprint", key: "frameSegmentBp" };
    case "fabricateJob":
      return { type: "addBlank", blueprintKey: "plasmaBp" };
    case "shipBuild":
      return { type: "addShip", typeKey: "generalFreighter" };
    case "equipmentStorageUpgrade":
      return { type: "equipmentStorageLevelUp" };
    case "docksExpansion":
      return { type: "docksCapacityUp" };
    case "transitBerthExpansion":
      return { type: "transitBerthLevelUp" };
    case "shipRepair":
      return { type: "clearShipDamage", shipId: "ship-1" };
    case "salvageJob":
      return { type: "salvageResolve", target: { kind: "material", itemId: "frameSegment" } };
    case "relicStudy":
      return { type: "identifyRelic", token: relicToken(), studyIndex: 1 };
    case "dataStudy":
      return { type: "studyData", itemId: "propulsionData", studyIndex: 1 };
  }
}

function relicToken(): RelicVaultToken {
  return { id: "t1", tier: "standard", quality: 0, setId: "precursor", poiId: RELIC_SETS.find((s) => s.id === "precursor")!.sources[0] };
}

// Every timed process kind, as a Record so a NEW kind fails to compile here until the every-process tests cover it.
const KIND_COVERED: Record<TimedProcessKind, true> = {
  refineJob: true,
  facilityUpgrade: true,
  fuelRefineJob: true,
  researchProject: true,
  fabricateJob: true,
  shipBuild: true,
  equipmentStorageUpgrade: true,
  docksExpansion: true,
  transitBerthExpansion: true,
  shipRepair: true,
  salvageJob: true,
  relicStudy: true,
  dataStudy: true,
};
const ALL_KINDS = Object.keys(KIND_COVERED) as TimedProcessKind[];

function withJob(kind: TimedProcessKind, ticks = JOB_TICKS, base: GameState = rich()): { state: GameState; ref: ProcessRef } {
  // A repair needs a damaged hull to clear.
  const s = kind === "shipRepair" ? { ...base, ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, damaged: true, repairDamage: 100 } : sh)) } : base;
  const r = startProcess(s, kind, {}, ticks, effectFor(kind));
  expect(r.started).toBe(true);
  const p = r.next.activeProcesses[r.next.activeProcesses.length - 1];
  return { state: r.next, ref: { kind: "process", id: p.id } };
}

function jobOf(s: GameState, ref: ProcessRef): TimedProcess | undefined {
  return ref.kind === "process" ? s.activeProcesses.find((p) => p.id === ref.id) : undefined;
}

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

// The tick a job completes on when stepped one tick at a time (the live loop).
function completionTick(s: GameState, ref: ProcessRef, guard = 5000): number {
  let out = s;
  for (let i = 1; i <= guard; i++) {
    out = economyTick(out, 1, RNG);
    if (!jobOf(out, ref)) return i;
  }
  throw new Error("never completed");
}

// Whole-state equality through the save's own JSON (a Decimal's -0 and 0 mantissas serialize alike).
function same(a: GameState, b: GameState): void {
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
}

function buy(s: GameState, ref: ProcessRef): GameState {
  const r = buyOvertime(s, ref);
  expect(r.bought, String(r.reason)).toBe(true);
  return r.next;
}

// ============================================================================
// Overtime
// ============================================================================

describe("Overtime: the shape the user chose (+25% steps, never doubling, never instant)", () => {
  it("each step adds 25% of the normal rate, and the most a job can reach stays under double", () => {
    expect(OVERTIME_STEP_RATE).toBe(0.25);
    expect(overtimeRate(0)).toBe(1);
    expect(overtimeRate(1)).toBe(1.25);
    expect(overtimeRate(OVERTIME_MAX_STEPS)).toBeLessThan(2);
    expect(OVERTIME_MAX_STEPS).toBeGreaterThanOrEqual(2);
  });

  it("is offered on the kinds the user named: Shipyard builds and repairs, research (GG-5: the Lab's data study too), facility upgrades", () => {
    expect([...OVERTIME_PROCESS_KINDS].sort()).toEqual(
      ["dataStudy", "docksExpansion", "equipmentStorageUpgrade", "facilityUpgrade", "researchProject", "shipBuild", "shipRepair", "transitBerthExpansion"].sort(),
    );
  });
});

describe("Overtime: a sped-up job completes at the right tick, stepped or caught up (offline == live)", () => {
  for (const kind of OVERTIME_PROCESS_KINDS) {
    it(`${kind}: one step bought at the start finishes a ${JOB_TICKS}-tick job at tick ${JOB_TICKS / 1.25}`, () => {
      const { state, ref } = withJob(kind);
      const sped = buy(state, ref);
      expect(jobOf(sped, ref)!.remainingTicks).toBe(JOB_TICKS / 1.25);
      expect(completionTick(sped, ref)).toBe(JOB_TICKS / 1.25);
      // One catch-up call over the same span lands the identical state (the offline path).
      const n = JOB_TICKS / 1.25;
      same(economyTick(sped, n, RNG), stepped(sped, n));
      expect(jobOf(economyTick(sped, n - 1, RNG), ref)).toBeDefined();
    });
  }

  it("steps bought mid-job only speed the work still left (400 normal, 200 at +25%, the rest at +50%)", () => {
    const { state, ref } = withJob("shipBuild");
    let s = stepped(state, 400);
    s = buy(s, ref); // 600 left -> 480 at 1.25
    expect(jobOf(s, ref)!.remainingTicks).toBe(480);
    s = stepped(s, 200); // 280 left at 1.25 = 350 normal ticks of work
    s = buy(s, ref); // 350 of work at 1.5
    expect(jobOf(s, ref)!.remainingTicks).toBeCloseTo(350 / 1.5, 9);
    // 400 + 200 + 233.33 = 833.33 ticks: the stepped loop completes on tick 834, the one-shot catch-up in the same
    // call (the countdown is the same subtraction either way).
    expect(completionTick(s, ref)).toBe(234);
    same(economyTick(s, 234, RNG), stepped(s, 234));
    // The work done adds up to the job's normal size.
    expect(400 + 200 * 1.25 + (350 / 1.5) * 1.5).toBeCloseTo(JOB_TICKS, 9);
  });

  it("keeps the job's size (and its lump Fleet Admiral XP) as it was: only the time left changes", () => {
    const { state, ref } = withJob("researchProject");
    const sped = buy(state, ref);
    expect(jobOf(sped, ref)!.durationTicks).toBe(JOB_TICKS);
    const normalDone = economyTick(state, JOB_TICKS, RNG);
    const spedDone = economyTick(sped, JOB_TICKS / 1.25, RNG);
    expect(spedDone.lifetimeStats.fleetAdminXpAwarded.toString()).toBe(normalDone.lifetimeStats.fleetAdminXpAwarded.toString());
    expect(spedDone.fleetAdminLevel).toBe(normalDone.fleetAdminLevel);
  });

  it("the rate and the work fraction read the bought steps", () => {
    const { state, ref } = withJob("shipBuild");
    const sped = buy(buy(state, ref), ref);
    const job = jobOf(sped, ref)!;
    expect(job.speed?.overtimeSteps).toBe(2);
    expect(processRate(job)).toBe(1.5);
    expect(processWorkFraction(job)).toBeCloseTo(0, 9); // nothing done yet: the remaining work is the whole job
    const later = jobOf(stepped(sped, 100), ref)!;
    expect(processWorkFraction(later)).toBeCloseTo(150 / JOB_TICKS, 9);
    expect(processRate(jobOf(state, ref)!)).toBe(1);
  });

  it("makes no draws (deterministic) and charges exactly the quoted price", () => {
    const { state, ref } = withJob("facilityUpgrade");
    const spy = vi.spyOn(Math, "random");
    const quote = canBuyOvertime(state, ref);
    expect(quote.ok).toBe(true);
    const r = buyOvertime(state, ref);
    expect(spy).not.toHaveBeenCalled();
    expect(r.cost).toBe(quote.ok ? quote.cost : -1);
    expect(state.credits.minus(r.next.credits).toNumber()).toBe(r.cost);
  });
});

describe("Overtime: the price rises each step and scales with job size and tier [PROPOSAL]", () => {
  it("cost = ceil(credits per minute x job minutes x tier x step)", () => {
    const { state, ref } = withJob("shipBuild", 1200); // a 20-minute General Freighter build, tier 1
    const job = jobOf(state, ref)!;
    expect(overtimeTier(state, job)).toBe(SHIP_TYPES.generalFreighter.tier);
    for (let step = 1; step <= OVERTIME_MAX_STEPS; step++) {
      expect(overtimeStepCost(state, job, step)).toBe(Math.ceil(OVERTIME_CREDITS_PER_MINUTE * 20 * 1 * step));
    }
    expect(overtimeStepCost(state, job, 2)).toBeGreaterThan(overtimeStepCost(state, job, 1));
  });

  it("a bigger job or a higher tier costs more", () => {
    const small = withJob("researchProject", 600);
    const big = withJob("researchProject", 1200);
    expect(overtimeStepCost(big.state, jobOf(big.state, big.ref)!, 1)).toBeGreaterThan(overtimeStepCost(small.state, jobOf(small.state, small.ref)!, 1));
    const t1 = withJob("shipBuild", 600, rich());
    const t3State = startProcess(rich(), "shipBuild", {}, 600, { type: "addShip", typeKey: "battleship" }).next;
    const t3Job = t3State.activeProcesses[t3State.activeProcesses.length - 1];
    expect(overtimeTier(t3State, t3Job)).toBe(SHIP_TYPES.battleship.tier);
    expect(overtimeStepCost(t3State, t3Job, 1)).toBeGreaterThan(overtimeStepCost(t1.state, jobOf(t1.state, t1.ref)!, 1));
  });

  it("reads each kind's tier: the hull, the blueprint, the rung being built", () => {
    const research = withJob("researchProject");
    expect(overtimeTier(research.state, jobOf(research.state, research.ref)!)).toBe(BLUEPRINTS.frameSegmentBp.tier);
    const facility = withJob("facilityUpgrade"); // refinery level 0 -> building rung 1
    expect(overtimeTier(facility.state, jobOf(facility.state, facility.ref)!)).toBe((facility.state.facilities.refinery?.level ?? 0) + 1);
    const repair = withJob("shipRepair");
    expect(overtimeTier(repair.state, jobOf(repair.state, repair.ref)!)).toBe(SHIP_TYPES.generalFreighter.tier);
    const storage = withJob("equipmentStorageUpgrade");
    expect(overtimeTier(storage.state, jobOf(storage.state, storage.ref)!)).toBe(storage.state.equipmentStorageLevel + 1);
  });
});

describe("Overtime: refusals", () => {
  it("refuses kinds the user did not name, runs and expeditions", () => {
    for (const kind of ALL_KINDS.filter((k) => !OVERTIME_PROCESS_KINDS.includes(k))) {
      const { state, ref } = withJob(kind);
      expect(canBuyOvertime(state, ref), kind).toEqual({ ok: false, reason: "notEligible" });
    }
    expect(canBuyOvertime(rich(), { kind: "run", captainId: 1 })).toEqual({ ok: false, reason: "notEligible" });
    expect(canBuyOvertime(rich(), { kind: "expedition", id: "expedition-1" })).toEqual({ ok: false, reason: "notEligible" });
  });

  it("refuses a missing job, a maxed job, a skipped job, a job about to finish, and a short balance", () => {
    expect(canBuyOvertime(rich(), { kind: "process", id: "proc-404" })).toEqual({ ok: false, reason: "notFound" });
    const { state, ref } = withJob("shipBuild");
    let s = state;
    for (let i = 0; i < OVERTIME_MAX_STEPS; i++) s = buy(s, ref);
    expect(canBuyOvertime(s, ref)).toEqual({ ok: false, reason: "maxSteps" });
    const skipped = applyTimeSkip(state, ref).next;
    expect(canBuyOvertime(skipped, ref)).toEqual({ ok: false, reason: "skipped" });
    const nearlyDone = stepped(state, JOB_TICKS - 1);
    expect(canBuyOvertime(nearlyDone, ref)).toEqual({ ok: false, reason: "finishing" });
    const broke = { ...state, credits: new Decimal(0) };
    expect(canBuyOvertime(broke, ref)).toMatchObject({ ok: false, reason: "credits" });
    const r = buyOvertime(broke, ref);
    expect(r.bought).toBe(false);
    expect(r.next).toBe(broke);
  });

  // FR-C lane 1 M1: a job completes once its time left reaches 0, so it finishes after ceil(remainingTicks) ticks. A step
  // whose rescale leaves that whole-tick count unchanged buys nothing, so it is refused ("finishing") and never sold.
  it("refuses a step that would save no whole tick, and every sold step saves at least one", () => {
    const { state, ref } = withJob("shipBuild");
    for (let left = 40; left >= 2; left--) {
      let s = stepped(state, JOB_TICKS - left);
      for (let k = 0; k < OVERTIME_MAX_STEPS; k++) {
        const job = s.activeProcesses.find((p) => p.id === (ref as { id: string }).id)!;
        const q = canBuyOvertime(s, ref);
        if (!q.ok) {
          if (q.reason === "finishing" && job.remainingTicks > 1) {
            // Refused for saving nothing: the next step's whole-tick count really is unchanged.
            const after = buyOvertimeIgnoringWholeTicks(job, k);
            expect(Math.ceil(after), `left ${left}, step ${k + 1}`).toBe(Math.ceil(job.remainingTicks));
          }
          break;
        }
        const before = Math.ceil(job.remainingTicks);
        s = buy(s, ref);
        const now = s.activeProcesses.find((p) => p.id === (ref as { id: string }).id)!;
        expect(before - Math.ceil(now.remainingTicks), `left ${left}, step ${k + 1}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// FR-C fix pass: the refusal counts whole ticks with the completion's own rule (ceil(x - epsilon)), so a float leftover
// like 4.000000000000001 (which completes on tick 4, not 5) cannot let a step that saves nothing through.
describe("Overtime: the whole-tick rule matches completion", () => {
  it("refuses a step on a float leftover that would still complete on the same tick", () => {
    const { state, ref } = withJob("shipBuild");
    const id = (ref as { id: string }).id;
    const leftover = 4.000000000000001;
    const s: GameState = { ...state, activeProcesses: state.activeProcesses.map((p) => (p.id === id ? { ...p, remainingTicks: leftover } : p)) };
    // 4.000000000000001 completes on its 4th tick; one step would leave 3.2, which completes on its 4th tick too.
    expect(completionTick(s, ref)).toBe(4);
    const q = canBuyOvertime(s, ref);
    expect(q).toEqual({ ok: false, reason: "finishing" });
    expect(buyOvertime(s, ref).next).toBe(s);
  });

  it("still sells a step that saves a whole tick by the completion's count", () => {
    const { state, ref } = withJob("shipBuild");
    const id = (ref as { id: string }).id;
    const s: GameState = { ...state, activeProcesses: state.activeProcesses.map((p) => (p.id === id ? { ...p, remainingTicks: 5.000000000000001 } : p)) };
    // 5 ticks becomes 4 (5.000000000000001 x 0.8 = 4.000000000000001, which completes on its 4th tick).
    expect(canBuyOvertime(s, ref).ok).toBe(true);
    expect(completionTick(buy(s, ref), ref)).toBe(4);
  });
});

// The time left one more Overtime step would leave (processSpeed.ts rescale, without its whole-tick rule).
function buyOvertimeIgnoringWholeTicks(job: { remainingTicks: number }, steps: number): number {
  return (job.remainingTicks * overtimeRate(steps)) / overtimeRate(steps + 1);
}

// ============================================================================
// OT-UI (user 2026-11-10): "Show both times" (the completion log) and "Chip + no jump" (the bar measures work done)
// ============================================================================

const T0 = 1_800_000_000_000; // a real wall clock, so the completion log stamps are known

// Step a state through tick() in chunks of `chunk` seconds over `seconds`, the clock ending each chunk where live play
// would stamp it (the offline path is one call, live is 1 s steps).
function tickedBy(s: GameState, seconds: number, chunk: number, startMs: number): GameState {
  let out = s;
  let at = startMs;
  for (let left = seconds; left > 0; left -= chunk) {
    const span = Math.min(chunk, left);
    at += span * 1000;
    out = tick(span, out, RNG, at);
  }
  return out;
}

function lastEntry(s: GameState) {
  const log = s.completionLog ?? [];
  return log[log.length - 1];
}

describe("OT-UI: the completion log shows both times (the true start, the normal length)", () => {
  it("a 600-tick build sped up 200 ticks in: took 520 s with Overtime, 600 s at the normal rate, started when it started", () => {
    const { state, ref } = withJob("shipBuild", 600);
    let s = tickedBy(state, 200, 200, T0);
    const quote = canBuyOvertime(s, ref);
    expect(quote).toMatchObject({ ok: true, step: 1, ticksSaved: 80 });
    s = buy(s, ref);
    expect(jobOf(s, ref)!.speed).toEqual({ overtimeSteps: 1, ticksSaved: 80 });
    s = tickedBy(s, 320, 320, T0 + 200_000);
    expect(jobOf(s, ref)).toBeUndefined();
    const e = lastEntry(s);
    expect(e.kind).toBe("shipBuild");
    expect(e.atMs).toBe(T0 + 520_000);
    expect(e.startedAtMs).toBe(T0); // the true start, never "finish minus the full length"
    expect(e.atMs - e.startedAtMs).toBe(520_000);
    expect(e.overtime).toEqual({ steps: 1, normalMs: 600_000 });
  });

  it("two steps with a fractional time left: the stamp counts the whole ticks the countdown ran", () => {
    const { state, ref } = withJob("researchProject", 1000);
    let s = tickedBy(state, 401, 401, T0); // 599 left
    s = buy(s, ref); // 599 / 1.25 = 479.2 left
    s = tickedBy(s, 150, 150, T0 + 401_000); // 329.2 left at 1.25
    s = buy(s, ref); // 329.2 x 1.25 / 1.5 = 274.33 left
    const job = jobOf(s, ref)!;
    expect(job.remainingTicks).toBeCloseTo((329.2 * 1.25) / 1.5, 9);
    const ran = 401 + 150 + Math.ceil(job.remainingTicks);
    s = tickedBy(s, Math.ceil(job.remainingTicks), 1, T0 + 551_000);
    expect(jobOf(s, ref)).toBeUndefined();
    const e = lastEntry(s);
    expect(e.atMs).toBe(T0 + ran * 1000);
    expect(e.startedAtMs).toBe(T0);
    expect(e.overtime).toEqual({ steps: 2, normalMs: 1_000_000 });
  });

  it("offline == live: one call, 997 s chunks and 1 s steps write the same log and the same state", () => {
    const { state, ref } = withJob("facilityUpgrade", 3000);
    let s = tickedBy(state, 333, 333, T0);
    s = buy(s, ref);
    s = tickedBy(s, 517, 517, T0 + 333_000);
    s = buy(s, ref);
    const from = T0 + 850_000;
    const span = 2200;
    const oneCall = tickedBy(s, span, span, from);
    const chunks = tickedBy(s, span, 997, from);
    const steps = tickedBy(s, span, 1, from);
    expect(jobOf(steps, ref)).toBeUndefined();
    same(oneCall, steps);
    same(chunks, steps);
    const e = lastEntry(steps);
    expect(e.startedAtMs).toBe(T0);
    expect(e.overtime).toEqual({ steps: 2, normalMs: 3_000_000 });
  });

  it("a job without Overtime logs exactly as before: no overtime record, started = finish minus its full length", () => {
    const { state, ref } = withJob("shipBuild", 600);
    const s = tickedBy(state, 600, 600, T0);
    expect(jobOf(s, ref)).toBeUndefined();
    const e = lastEntry(s);
    expect("overtime" in e).toBe(false);
    expect(e.startedAtMs).toBe(T0);
    expect(JSON.stringify(s)).not.toContain('"overtime"');
  });

  it("an old save (steps bought before ticksSaved was recorded) claims no saving: no overtime record, the plain stamp", () => {
    const { state, ref } = withJob("shipBuild", 600);
    let s = tickedBy(state, 200, 200, T0);
    s = buy(s, ref);
    // The save as written before OT-UI: the steps, no ticksSaved.
    s = { ...s, activeProcesses: s.activeProcesses.map((p) => (p.id === jobOf(s, ref)!.id ? { ...p, speed: { overtimeSteps: 1 } } : p)) };
    expect(jobOf(s, ref)!.speed).toEqual({ overtimeSteps: 1 });
    s = tickedBy(s, 320, 320, T0 + 200_000);
    expect(jobOf(s, ref)).toBeUndefined();
    const e = lastEntry(s);
    expect(e.kind).toBe("shipBuild");
    expect("overtime" in e).toBe(false); // the saving was never measured, so the line never claims one
    expect(e.startedAtMs).toBe(e.atMs - 600_000); // the unchanged stamp (finish minus the full length)
    const row = buildHomeDashboard(s).recentlyCompleted.find((r) => r.id === e.id);
    expect(row).toBeDefined();
    expect("overtime" in row!).toBe(false);
  });

  it("the registry row is reachable on every kind: its fixture runs one job of each, and its move is exactly its own", () => {
    const s = withRunningJobs(wiringBase());
    const kinds = new Set(s.activeProcesses.map((p) => p.kind));
    for (const k of OVERTIME_PROCESS_KINDS) expect(kinds.has(k), k).toBe(true);
    const row = WIRING_REGISTRY.find((e) => e.id === OTUI_RESTATED_ID)!;
    expect(row.status.kind).toBe("live");
    expect(row.claim).toContain("data studies");
    const back = otUiReadBack(WIRING_REGISTRY);
    expect(back.length).toBe(WIRING_REGISTRY.length);
    back.forEach((e, i) => {
      if (e.id === OTUI_RESTATED_ID) expect(e.claim).toBe("Overtime: each step bought speeds a running job by 25% of its normal rate (Shipyard builds and repairs, research, facility upgrades)");
      else expect(e).toBe(WIRING_REGISTRY[i]);
    });
  });

  it("the bar measures work done: a purchase never moves it, at the normal rate it is the old formula bit for bit", () => {
    const { state, ref } = withJob("docksExpansion", 700);
    const s = stepped(state, 301);
    const before = jobOf(s, ref)!;
    expect(processWorkFraction(before)).toBe((before.durationTicks - before.remainingTicks) / before.durationTicks);
    const after = jobOf(buy(s, ref), ref)!;
    expect(processWorkFraction(after)).toBeCloseTo(processWorkFraction(before), 12);
    expect(after.remainingTicks).toBeLessThan(before.remainingTicks);
  });
});

// ============================================================================
// The time skip (tutorial only; nothing calls it in 0.14.0)
// ============================================================================

describe("time skip: every timed process finishes on the next tick, for free", () => {
  for (const kind of ALL_KINDS) {
    it(`${kind}`, () => {
      let base = rich();
      if (kind === "relicStudy") base = { ...base, relicVault: [] };
      const { state, ref } = withJob(kind, JOB_TICKS, base);
      expect(canApplyTimeSkip(state, ref)).toEqual({ ok: true });
      const r = applyTimeSkip(state, ref);
      expect(r.applied).toBe(true);
      const job = jobOf(r.next, ref)!;
      expect(job.remainingTicks).toBe(0);
      expect(job.speed?.instantComplete).toBe(true);
      expect(r.next.credits.toString()).toBe(state.credits.toString()); // free
      const after = economyTick(r.next, 1, RNG);
      expect(jobOf(after, ref)).toBeUndefined();
      // The completion applied what the job would have applied at its natural end.
      const natural = economyTick(state, JOB_TICKS, RNG);
      const pick = (s: GameState) => ({
        facilities: s.facilities,
        researched: s.researchedBlueprints,
        ships: s.ships.map((sh) => ({ id: sh.id, typeKey: sh.typeKey, damaged: sh.damaged ?? false })),
        blanks: s.blanks,
        storage: s.equipmentStorageLevel,
        docks: s.shipStorageCapacity,
        berths: s.transitBerthCapacity,
        frame: itemTotal(s.inventory, "frameSegment").toString(),
        museum: generalMuseumRecord(s),
      });
      expect(pick(after)).toEqual(pick(natural));
    });
  }

  it("refuses a missing job and a job already skipped", () => {
    expect(canApplyTimeSkip(rich(), { kind: "process", id: "proc-404" })).toEqual({ ok: false, reason: "notFound" });
    const { state, ref } = withJob("researchProject");
    const once = applyTimeSkip(state, ref).next;
    expect(canApplyTimeSkip(once, ref)).toEqual({ ok: false, reason: "alreadySkipped" });
    expect(applyTimeSkip(once, ref).next).toBe(once);
  });

  it("makes no draws", () => {
    const { state, ref } = withJob("shipBuild");
    const spy = vi.spyOn(Math, "random");
    applyTimeSkip(state, ref);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("time skip: a mission cycle runs through to its delivery on the next tick", () => {
  const mission = () => {
    const r = dispatchCaptainOnMission(freshState(), 1, "shortOreRun");
    expect(r.success).toBe(true);
    return r.next;
  };
  // The ticks one cycle takes when played out (stepped until the cycle's delivery counts).
  const cycleTicks = (s: GameState): number => {
    const before = s.lifetimeStats.missionsCompleted.shortOreRun?.toString();
    let out = s;
    for (let i = 1; i < 5000; i++) {
      out = economyTick(out, 1, RNG);
      if (out.lifetimeStats.missionsCompleted.shortOreRun?.toString() !== before) return i;
    }
    throw new Error("no delivery");
  };
  const outcome = (s: GameState) => ({ captain: s.captains[0], inventory: s.inventory, credits: s.credits.toString(), stats: s.lifetimeStats.missionsCompleted });

  it("from the start: the skip plus one tick equals the cycle played out plus one tick (the same haul)", () => {
    const s = mission();
    const n = cycleTicks(s);
    const skipped = applyTimeSkip(s, { kind: "run", captainId: 1 });
    expect(skipped.applied).toBe(true);
    expect(skipped.next.captains[0].mission?.speed?.instantComplete).toBe(true);
    const after = economyTick(skipped.next, 1, RNG);
    expect(outcome(after)).toEqual(outcome(economyTick(s, n + 1, RNG)));
    expect(after.captains[0].mission?.speed).toBeUndefined(); // the next cycle runs at normal speed
  });

  it("mid-cycle: only the rest of the current cycle is skipped", () => {
    const s = stepped(mission(), 60);
    const n = cycleTicks(s);
    const after = economyTick(applyTimeSkip(s, { kind: "run", captainId: 1 }).next, 1, RNG);
    expect(outcome(after)).toEqual(outcome(economyTick(s, n + 1, RNG)));
  });

  it("after the skip, one catch-up call equals the same span stepped (offline == live)", () => {
    const skipped = applyTimeSkip(stepped(mission(), 30), { kind: "run", captainId: 1 }).next;
    same(economyTick(skipped, 200, RNG), stepped(skipped, 200));
  });

  it("a recalled mission delivers and stands down", () => {
    const s = recallCaptain(stepped(mission(), 10), 1).next;
    const after = economyTick(applyTimeSkip(s, { kind: "run", captainId: 1 }).next, 1, RNG);
    expect(after.captains[0].mission).toBeNull();
    expect(after.lifetimeStats.missionsCompleted.shortOreRun?.toString()).toBe("1");
  });

  it("refuses an idle captain and a run already skipped", () => {
    expect(canApplyTimeSkip(freshState(), { kind: "run", captainId: 1 })).toEqual({ ok: false, reason: "notFound" });
    const once = applyTimeSkip(mission(), { kind: "run", captainId: 1 }).next;
    expect(canApplyTimeSkip(once, { kind: "run", captainId: 1 })).toEqual({ ok: false, reason: "alreadySkipped" });
  });
});

// G1-4: a short-range cycle is a mission cycle too (the run ref); the cycle engine honors the flag (shortRangeCycle.ts).
describe("time skip: a short-range cycle runs through to its delivery on the next tick (G1-4)", () => {
  // A crewed Eir with a sensor array meets the Tier I sheet (shortRangeBoard.test.ts); slot 0's next roll.
  const qualified = (): GameState => {
    const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
    return installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
  };
  const run = (s: GameState = qualified()): GameState => {
    const r = dispatchCaptainOnShortRange(s, 1, 0);
    expect(r.success).toBe(true);
    return r.next;
  };
  const planOf = (s: GameState) => {
    const m = s.captains[0].mission;
    if (m === null || m.kind !== "shortRange") throw new Error("not on a short-range run");
    return m;
  };
  const outcome = (s: GameState) => ({ captain: s.captains[0], inventory: s.inventory, credits: s.credits.toString(), stats: s.lifetimeStats, board: s.shortRangeBoard });

  it("the skip plus one tick equals the cycle played out plus one tick (the same pay, XP and next roll)", () => {
    const s = stepped(run(), 5);
    const m = planOf(s);
    const left = m.plan.totalTicks - 5;
    const skipped = applyTimeSkip(s, { kind: "run", captainId: 1 });
    expect(skipped.applied).toBe(true);
    const after = economyTick(skipped.next, 1, RNG);
    expect(outcome(after)).toEqual(outcome(economyTick(s, left + 1, RNG)));
    expect(planOf(after).speed).toBeUndefined(); // the next cycle runs at normal speed
  });

  it("a skip on a cycle waiting at home for its load waits with it, then runs through once it can leave", () => {
    let s = run();
    // Find a drop-off roll on slot 0 and wait at home without credits.
    while (planOf(s).roll.template !== "supplyDropOff") s = stepped(s, planOf(s).plan.totalTicks);
    s = { ...s, credits: new Decimal(0) };
    const skipped = applyTimeSkip(s, { kind: "run", captainId: 1 }).next;
    const waited = economyTick(skipped, 1, RNG);
    expect(planOf(waited).phaseProgressTicks).toBe(0);
    expect(planOf(waited).speed?.instantComplete).toBe(true);
    const funded = economyTick({ ...waited, credits: new Decimal(1_000_000) }, 1, RNG);
    expect(planOf(funded).roll.cycleIndex).toBe(planOf(s).roll.cycleIndex + 1);
  });

  it("after the skip, one catch-up call equals the same span stepped (offline == live)", () => {
    const skipped = applyTimeSkip(stepped(run(), 30), { kind: "run", captainId: 1 }).next;
    same(economyTick(skipped, 400, RNG), stepped(skipped, 400));
  });
});

describe("time skip: a patrol route runs through to its end on the next tick", () => {
  const PATROL_KEY = "crimsonReaverSweep";
  const DEF = PATROLS[PATROL_KEY];
  const ROUTE = DEF.transitOutTicks + DEF.rollWindowTicks + DEF.transitBackTicks;
  const patrol = (repeat: boolean, typeKey: ShipTypeKey = "destroyer") => {
    const base = freshState();
    const s = installMissingCombatBaselines({
      ...base,
      nextPatrolSeed: 7,
      credits: new Decimal(100000),
      ships: base.ships.map((sh) => (sh.id === "ship-1" ? { ...sh, typeKey } : sh)),
    });
    const r = dispatchCaptainOnPatrol(s, 1, PATROL_KEY, "balanced", repeat);
    expect(r.success).toBe(true);
    return r.next;
  };
  const outcome = (s: GameState) => ({ captain: s.captains[0], inventory: s.inventory, credits: s.credits.toString(), ships: s.ships });

  it("a one-route patrol: the skip plus one tick equals the route flown out", () => {
    const s = patrol(false);
    const after = economyTick(applyTimeSkip(s, { kind: "run", captainId: 1 }).next, 1, RNG);
    expect(after.captains[0].mission).toBeNull();
    expect(outcome(after)).toEqual(outcome(economyTick(s, ROUTE, RNG)));
  });

  it("after the skip, one catch-up call equals the same span stepped (offline == live)", () => {
    const skipped = applyTimeSkip(stepped(patrol(true), 2), { kind: "run", captainId: 1 }).next;
    same(economyTick(skipped, 3 * ROUTE + 5, RNG), stepped(skipped, 3 * ROUTE + 5));
  });

  it("a repeating patrol: the next route starts at normal speed with the tick's own time", () => {
    const s = stepped(patrol(true), 3);
    const after = economyTick(applyTimeSkip(s, { kind: "run", captainId: 1 }).next, 1, RNG);
    expect(after.captains[0].mission?.speed).toBeUndefined();
    expect(outcome(after)).toEqual(outcome(economyTick(s, ROUTE - 3 + 1, RNG)));
  });
});

// Wiring OC-G1 (user 2026-10-16 "Delete it"): "completes now, and matches the run advanced naturally in ten-minute steps"
// pinned the time skip on a LEGACY run (the deleted engine path) and is RETIRED with it; the Ground Ops time skip is
// pinned in the next describe.
describe("time skip: an expedition that cannot finish is refused", () => {
  it("refuses a run that cannot finish on its own (a team that keeps failing) and a missing run", () => {
    const ready = ensureMinimumAwayTeam(freshState(), "ship-1");
    const cands = expeditionCandidates(ready, "ship-1");
    // Safe first runs SF-3: pinned on the run as dispatched before the curve (a new save's first ordinary run sits at the
    // curve's floor, gentle enough to finish).
    const r = asPreCurveDispatch(dispatchPastPropulsion(ready, "ship-1", 1, cands[0].id, true));
    expect(canApplyTimeSkip(r.next, { kind: "expedition", id: r.next.expeditions[0].id })).toEqual({ ok: false, reason: "cannotFinish" });
    expect(canApplyTimeSkip(freshState(), { kind: "expedition", id: "expedition-9" })).toEqual({ ok: false, reason: "notFound" });
  });
});

describe("time skip: a Ground Ops expedition finishes now and its claim matches normal play", () => {
  // The GO-7b parity squad (a medic aboard): its runs fight, recover in the medical bay and come home.
  const member = (id: string, teamType: AwayMember["teamType"], over: Partial<AwayMember> = {}): AwayMember => ({ ...plainAwayMember(id, teamType, "ship-1"), ...over });
  const SQUAD: AwayMember[] = [member("member-1", "security", { rank: 3 }), member("member-2", "security", { rank: 2, traits: ["fieldMedic"] }), member("member-11", "science")];
  const START = 5000; // the skip happens with the game clock well past 0
  const dispatched = (seed: number): GameState | null => {
    const s = withSlottedAwayTeams({ ...freshState(), gameTimeSeconds: START, awayMembers: SQUAD.map((m) => ({ ...m })), nextAwayMemberId: 100, expeditionSeed: seed });
    const r = dispatchPastPropulsion(s, "ship-1", 1, expeditionCandidates(s, "ship-1")[0].id);
    return r.success && r.next.expeditions[0]?.groundOps ? r.next : null;
  };
  // Normal play: the run advanced on its own clock to its natural end E, claimed at E.
  const natural = (s: GameState): { at: GameState; done: Expedition } => {
    const done = advanceExpedition(s.expeditions[0], s.gameTimeSeconds + 30 * 24 * 3600);
    return { at: { ...s, gameTimeSeconds: done.phaseAnchorSeconds, expeditions: [done] }, done };
  };
  // Everything a claim decides, with every time read relative to the claim's own game clock.
  const claimView = (s: GameState) => {
    const c = claimExpedition(s, s.expeditions[0].id);
    expect(c.success).toBe(true);
    const now = s.gameTimeSeconds;
    return {
      findings: c.findings,
      injuries: (c.injuries ?? []).map((i) => ({ memberId: i.memberId, recoverySeconds: i.recoverySeconds, untilIn: i.untilSeconds - now })),
      members: c.next.awayMembers.map((m) => ({
        id: m.id,
        untilIn: m.injuredUntilSeconds === undefined ? null : m.injuredUntilSeconds - now,
        atIn: m.injuredAtSeconds === undefined ? null : m.injuredAtSeconds - now,
      })),
      inventory: c.next.inventory,
      credits: c.next.credits.toString(),
      relicVault: c.next.relicVault,
      ships: c.next.ships,
      officers: c.next.officers,
      runCounts: c.next.runCounts,
    };
  };

  // Seeds whose Ground Ops run finishes on its own.
  const finishing: number[] = [];
  for (let seed = 1; seed <= 40 && finishing.length < 6; seed++) {
    const s = dispatched(seed);
    if (s && natural(s).done.phase === "complete") finishing.push(seed);
  }

  // The bug this guards: a bay stay that ends after the skip's game time but before the run's natural end. Read on
  // the game clock it would bring the member home injured; at the natural end they are already cured.
  it("the fixture finds Ground Ops runs that finish, one of them with a bay stay that ends after the skip's game time", () => {
    expect(finishing.length).toBeGreaterThan(0);
    const bayAfterNow = finishing.some((seed) => natural(dispatched(seed)!).done.groundOps!.teams.some((t) => Object.values(t.bayEnds).some((until) => until > START)));
    expect(bayAfterNow, "no finishing seed used the medical bay: widen the search").toBe(true);
  });

  it("a member still in the bay at the natural end comes home with exactly the time left at that end", () => {
    const s = dispatched(finishing[0])!;
    const { at, done } = natural(s);
    const end = done.phaseAnchorSeconds;
    const team = done.groundOps!.teams[0];
    const inBay: Expedition = { ...done, groundOps: { ...done.groundOps!, teams: [{ ...team, bayEnds: { "member-1": end + 1000 }, bayStart: end - 500 }, ...done.groundOps!.teams.slice(1)] } };
    const offset = end - START;
    const naturalHome = applyGroundOpsInjuries(at, inBay);
    const skippedHome = applyGroundOpsInjuries({ ...at, gameTimeSeconds: START }, { ...inBay, speed: { instantComplete: true, clockOffsetSeconds: offset } });
    expect(naturalHome.injuries).toEqual([{ memberId: "member-1", recoverySeconds: 1000, untilSeconds: end + 1000 }]);
    expect(skippedHome.injuries).toEqual([{ memberId: "member-1", recoverySeconds: 1000, untilSeconds: START + 1000 }]);
    const m = skippedHome.next.awayMembers.find((x) => x.id === "member-1")!;
    expect([m.injuredAtSeconds, m.injuredUntilSeconds]).toEqual([START - 500, START + 1000]);
  });

  it("findings, injuries, deposits and counters equal the run played out and claimed at its natural end", () => {
    for (const seed of finishing) {
      const s = dispatched(seed)!;
      const r = applyTimeSkip(s, { kind: "expedition", id: s.expeditions[0].id });
      expect(r.applied, `seed ${seed}`).toBe(true);
      const skipped = r.next.expeditions[0];
      const { at, done } = natural(s);
      expect(skipped.phase).toBe("complete");
      expect(skipped.speed?.clockOffsetSeconds).toBe(done.phaseAnchorSeconds - START);
      expect(skipped.findings, `seed ${seed}`).toEqual(done.findings);
      expect(claimView(r.next), `seed ${seed}`).toEqual(claimView(at));
    }
  });

  it("without a skip offset the Ground Ops claim reads the game clock as before", () => {
    const s = dispatched(finishing[0])!;
    const { at, done } = natural(s);
    expect(applyGroundOpsInjuries(at, done)).toEqual(applyGroundOpsInjuries(at, { ...done, speed: { instantComplete: true } }));
  });
});

describe("no modifier, no change: a state without a speed record never grows one", () => {
  it("stepping missions, patrols and processes writes no speed field", () => {
    let s = dispatchCaptainOnMission(rich(), 1, "shortOreRun").next;
    s = withJob("shipBuild", 300, s).state;
    s = stepped(s, 400);
    expect(JSON.stringify(s)).not.toContain('"speed"');
  });
});

// ============================================================================
// The grant hook (unused until the tutorial / quests patch)
// ============================================================================

describe("grant: items, credits, gear and a hull, with a log line", () => {
  it("adds every part and names each one in the log line", () => {
    const s = freshState();
    const r = grant(s, { credits: 500, items: { frameSegment: 4 }, gear: { plasmaBp: 1 }, hullType: "generalFreighter" }, "Tutorial: your first build");
    expect(r.granted).toBe(true);
    expect(r.next.credits.minus(s.credits).toNumber()).toBe(500);
    expect(itemTotal(r.next.inventory, "frameSegment").minus(itemTotal(s.inventory, "frameSegment")).toNumber()).toBe(4);
    expect(r.next.discovered).toContain("frameSegment");
    expect(r.next.blanks.plasmaBp?.map((b) => b.toNumber())).toEqual([1]); // ML-5: a granted blank is Q0
    expect(r.next.ships).toHaveLength(s.ships.length + 1);
    const minted = r.next.ships[r.next.ships.length - 1];
    expect(minted).toMatchObject({ id: `ship-${s.nextShipId}`, typeKey: "generalFreighter", assignedCaptainId: null });
    expect(r.next.nextShipId).toBe(s.nextShipId + 1);
    // The hull arrives the way a built one does: with its Standard Issue gear installed.
    expect(r.next.equipment.filter((e) => e.fittedToShipId === minted.id).length).toBeGreaterThan(0);
    expect(r.logLine).toBe("Tutorial: your first build. Received 500 credits, 4 Frame Segments, 1 uninspected Plasma Cannon and a General Freighter.");
    const plural = grant(s, { credits: 1, gear: { plasmaBp: 2 } }, "Test").logLine;
    expect(plural).toBe("Test. Received 1 credit and 2 uninspected Plasma Cannons.");
  });

  it("a minted hull matches the one a Shipyard build mints", () => {
    const built = economyTick(startProcess(rich(), "shipBuild", {}, 1, { type: "addShip", typeKey: "destroyer" }).next, 1, RNG);
    const granted = grant(rich(), { hullType: "destroyer" }, "Test").next;
    expect(granted.ships).toEqual(built.ships);
    expect(granted.equipment).toEqual(built.equipment);
    expect(granted.nextEquipmentId).toBe(built.nextEquipmentId);
  });

  // FR-C (user 2026-11-13/14, "Never discard"): a grant's items land in full, past the cap, and the log names them all.
  it("items land in full even past the storage cap, and the log names what arrived", () => {
    const s = freshState();
    const cap = itemCap(s, "frameSegment").toNumber();
    const r = grant(s, { items: { frameSegment: cap + 1000 } }, "Quest reward");
    expect(Math.round(itemTotal(r.next.inventory, "frameSegment").toNumber())).toBe(cap + 1000);
    expect(r.logLine).toBe(`Quest reward. Received ${(cap + 1000).toLocaleString("en-US")} Frame Segments.`);
    expect(canGrant(r.next, { items: { frameSegment: 5 } })).toEqual({ ok: true });
  });

  // The pre-FR-C rule, with the change switched off (neverDiscardSwitch.fixture.ts): items filled up to the cap.
  it("with Never discard off: items respect the storage cap and the log names what arrived", () => withNeverDiscardOff(() => {
    const s = freshState();
    const cap = itemCap(s, "frameSegment").toNumber();
    const r = grant(s, { items: { frameSegment: cap + 1000 } }, "Quest reward");
    expect(itemTotal(r.next.inventory, "frameSegment").toNumber()).toBe(cap);
    expect(r.logLine).toBe(`Quest reward. Received ${cap.toLocaleString("en-US")} Frame Segments.`);
    // Nothing can arrive when every item is already at its cap: refused (the SAME state), not an empty success.
    expect(canGrant(r.next, { items: { frameSegment: 5 } })).toEqual({ ok: false, reason: "storageFull" });
    const none = grant(r.next, { items: { frameSegment: 5 } }, "Quest reward");
    expect(none.granted).toBe(false);
    expect(none.next).toBe(r.next);
    // A bundle that also carries something else still arrives, naming only what came.
    expect(grant(r.next, { credits: 3, items: { frameSegment: 5 } }, "Quest reward").logLine).toBe("Quest reward. Received 3 credits.");
  }));

  it("refuses atomically: an empty grant, a bad amount, an unknown item, a non-gear blueprint, an unknown hull, full docks", () => {
    const s = freshState();
    expect(canGrant(s, {})).toEqual({ ok: false, reason: "empty" });
    expect(canGrant(s, { credits: -5 })).toEqual({ ok: false, reason: "badAmount" });
    expect(canGrant(s, { items: { frameSegment: 1.5 } })).toEqual({ ok: false, reason: "badAmount" });
    expect(canGrant(s, { items: { notAnItem: 1 } })).toEqual({ ok: false, reason: "unknownItem" });
    expect(canGrant(s, { gear: { frameSegmentBp: 1 } })).toEqual({ ok: false, reason: "unknownGear" });
    expect(canGrant(s, { hullType: "dreadnought" as ShipTypeKey })).toEqual({ ok: false, reason: "unknownHull" });
    const full = { ...s, shipStorageCapacity: s.ships.length };
    expect(canGrant(full, { credits: 10, hullType: "generalFreighter" })).toEqual({ ok: false, reason: "docksFull" });
    const r = grant(full, { credits: 10, hullType: "generalFreighter" }, "Test");
    expect(r.granted).toBe(false);
    expect(r.next).toBe(full);
    expect(r.logLine).toBe("");
  });

  it("makes no draws", () => {
    const spy = vi.spyOn(Math, "random");
    grant(freshState(), { credits: 1, items: { frameSegment: 1 }, gear: { plasmaBp: 2 }, hullType: "destroyer" }, "Test");
    expect(spy).not.toHaveBeenCalled();
  });
});
