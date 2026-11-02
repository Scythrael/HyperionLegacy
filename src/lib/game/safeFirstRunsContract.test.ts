// Safe first runs SF-5 (docs/plans/2026-10-15-safe-first-runs-plan.md section 4 SF-5, the USER ANSWERS and the SF-1
// to SF-4 carry notes): the two run types that never fail, held to the contract.
//
// 1. GATHERING (every MISSIONS key, every hull that can fly it): no stop path ends in a defeat (delivery on Repeat,
//    recall mid-run, the broke wall at a relaunch), no hull damage, and the first-run marker (isFirstGatheringRun, the
//    "First run" line of SF-6, DISPLAY ONLY) reads true until the save's first delivered cycle, false after it.
// 2. THE G1 CONTRACT (the live short-range templates, built by G1 since this plan was written): every roll carries the
//    shared `difficulty` stamp from runDifficultyAt("shortRange", tier, template); a template's first run is its
//    training run (isFirstRun keyed per template) and its SMALLEST roll; later runs read the shared curve
//    (rampFraction through runRamp, Tier I only; Tier II full from its first run), the roll's reach never shrinking as
//    the curve climbs; the counters are keyed per template; and the live loop delivers every template's training run
//    with no defeat. G1's own tests (shortRange / shortRangeBoard / shortRangeCycle) cover the parts in depth; this
//    file is the single place the contract is asserted against every template.
// Tests only: no engine change, no golden moves.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { MISSIONS, SHIP_TYPES, freshState, type GameState, type MissionKey, type ShipTypeKey, type ShortRangeMissionState } from "./model";
import { canDispatch, dispatchCaptainOnMission, economyTick, recallCaptain } from "./tick";
import {
  N_FULL,
  countShortRangeCycleComplete,
  countShortRangeCycleStart,
  isFirstGatheringRun,
  isFirstRun,
  rampEnemyScale,
  rampFraction,
  runCountsOf,
  runDifficultyAt,
  runRamp,
} from "./runDifficulty";
import {
  SHORT_RANGE_TEMPLATES,
  SHORT_RANGE_TEMPLATE_KEYS,
  isTrainingRoll,
  rollShortRangeJob,
  shortRangeSpanShare,
  spanTop,
  type ShortRangeRoll,
  type ShortRangeSpans,
  type ShortRangeTemplateKey,
  type ShortRangeTier,
} from "./shortRange";
import { dispatchCaptainOnShortRange, shortRangeBoardSlots } from "./shortRangeBoard";
import { resolveCrew } from "./crewOverlay";
import { onHull } from "./firstRunsGoldens.fixture";
import { WIRING_CAPTAIN_ID, editShip, installPiece, wiringBase } from "./wiring/probes";
import { WIRING_REGISTRY } from "./wiring/registry";

const HULLS = Object.keys(SHIP_TYPES) as ShipTypeKey[];
const MISSION_KEYS = Object.keys(MISSIONS) as MissionKey[];
const MAX_UNLOCK = Math.max(...Object.values(MISSIONS).map((m) => m.unlockLevel));
const TICK_CAP = 5000;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ===== 1. gathering =====

// ship-1 on `hull`, the captain at level 10, Mission Control at the highest unlock level and the stores full (the SF-0
// golden 3 base), so the gate refuses only on what the hull decides. A true new game: no cycle delivered yet.
function gatherBase(hull: ShipTypeKey): GameState {
  const b = onHull(hull);
  return {
    ...b,
    credits: new Decimal(1_000_000_000),
    captains: b.captains.map((c) => ({ ...c, level: 10 })),
    facilities: { ...b.facilities, missionControl: { ...b.facilities.missionControl, level: MAX_UNLOCK } },
  };
}

const delivered = (s: GameState, key: MissionKey): boolean => s.lifetimeStats.missionsCompleted[key]?.gt(0) ?? false;

// Nothing on the run reads as lost, by ALLOW-LIST (so any new loss shape fails here): the stop reason is one of
// `stops`, no log entry carries a patrol ending at all, and the ship is neither damaged nor owes a repair.
function expectNeverLost(s: GameState, label: string, stops: readonly (string | undefined)[]): void {
  expect(stops, `${label}: stop reason`).toContain(s.captains[0].lastStopReason);
  for (const e of s.completionLog) expect([undefined, null], `${label}: a patrol ending`).toContain(e.patrolEndReason);
  const ship = s.ships.find((x) => x.id === "ship-1");
  expect(ship?.damaged ?? false, `${label}: hull damage`).toBe(false);
  expect(ship?.repairDamage ?? 0, `${label}: repair owed`).toBe(0);
}

describe("SF-5 gathering cannot be lost: every MISSIONS key x every hull x every stop path", () => {
  for (const key of MISSION_KEYS) {
    it(`${key}: delivered on Repeat, recalled mid-run and broke at the relaunch, never a defeat; the marker flips at the first delivery`, () => {
      let flown = 0;
      let brokeFlown = 0;
      for (const hull of HULLS) {
        const s0 = gatherBase(hull);
        if (!canDispatch(s0, 1, key).ok) continue;
        flown += 1;
        const label = `${hull} ${key}`;
        expect(isFirstGatheringRun(s0), `${label}: a new game`).toBe(true);

        // (a) Repeat: the marker holds on every tick before the first delivered cycle and is false from it on.
        const r = dispatchCaptainOnMission(s0, 1, key);
        expect(r.success, label).toBe(true);
        let s = r.next;
        const rng = lcg(0x5f5);
        let ticks = 0;
        while (!delivered(s, key)) {
          expect(isFirstGatheringRun(s), `${label}: before the delivery (tick ${ticks})`).toBe(true);
          s = economyTick(s, 1, rng);
          if (++ticks > TICK_CAP) throw new Error(`${label}: never delivered`);
        }
        expect(isFirstGatheringRun(s), `${label}: after the delivery`).toBe(false);
        expect(s.captains[0].mission, `${label}: still flying on Repeat`).not.toBeNull();
        expectNeverLost(s, `${label} repeat`, [undefined]);
        const firstCycleTicks = ticks;

        // (b) Recall half way through the first cycle: the ship flies home and the run ends, not lost.
        let rc = dispatchCaptainOnMission(s0, 1, key).next;
        const rng2 = lcg(0x5f5);
        for (let i = 0; i < Math.max(1, Math.floor(firstCycleTicks / 2)); i++) rc = economyTick(rc, 1, rng2);
        const recalled = recallCaptain(rc, 1);
        expect(recalled.success, `${label}: recall`).toBe(true);
        rc = recalled.next;
        ticks = 0;
        while (rc.captains[0].mission !== null) {
          rc = economyTick(rc, 1, rng2);
          if (++ticks > TICK_CAP) throw new Error(`${label}: the recall never landed`);
        }
        expectNeverLost(rc, `${label} recall`, [undefined]);

        // (c) Broke: no credits, flown past the first delivery (a transport idles on its working capital). The only
        // wall-stop gathering has is fuel; it never ends in a defeat.
        const broke0: GameState = { ...s0, credits: new Decimal(0) };
        const br = dispatchCaptainOnMission(broke0, 1, key);
        if (br.success) {
          brokeFlown += 1;
          let b = br.next;
          const rng3 = lcg(0x5f5);
          for (let i = 0; i < firstCycleTicks * 2 + 10 && b.captains[0].mission !== null; i++) b = economyTick(b, 1, rng3);
          expectNeverLost(b, `${label} broke`, [undefined, "fuel"]);
        }
      }
      expect(flown, `${key}: some hull flies it`).toBeGreaterThan(0);
      expect(brokeFlown, `${key}: some hull flies it broke`).toBeGreaterThan(0);
    });
  }

  it("the marker reads the MISSIONS keys only: patrol routes and short-range templates are their own run types; a veteran reads false", () => {
    const fresh = freshState();
    expect(isFirstGatheringRun(fresh)).toBe(true);
    const withStats = (done: Record<string, Decimal>): GameState => ({ ...fresh, lifetimeStats: { ...fresh.lifetimeStats, missionsCompleted: done } });
    expect(isFirstGatheringRun(withStats({ crimsonReaverSweep: new Decimal(3), "shortRange:telescopeRepair": new Decimal(2) }))).toBe(true);
    expect(isFirstGatheringRun(withStats({ shortOreRun: new Decimal(0) }))).toBe(true);
    for (const key of MISSION_KEYS) expect(isFirstGatheringRun(withStats({ [key]: new Decimal(1) })), key).toBe(false);
    // A save as loaded (serialized Decimal strings) reads the same.
    expect(isFirstGatheringRun(withStats({ shortOreRun: "4" as unknown as Decimal }))).toBe(false);
  });
});

// ===== 2. the G1 contract =====

const TIERS: readonly ShortRangeTier[] = [1, 2];
const SIZE_KEYS = ["guests", "units", "scan", "engineering", "security"] as const;

// The first cycle index whose roll on a tier-`tier` slot draws `template`, as the counters stand. Pure.
function rollOfTemplate(s: GameState, template: ShortRangeTemplateKey, tier: ShortRangeTier): ShortRangeRoll {
  const slot = { id: 0, tier };
  for (let i = 0; i < 4000; i++) {
    const roll = rollShortRangeJob(s, slot, i);
    if (roll.template === template) return roll;
  }
  throw new Error(`no ${template} roll at tier ${tier}`);
}

// The save with `template` started once and `completed` cycles of it delivered on the curve.
function afterRuns(s: GameState, template: ShortRangeTemplateKey, completed: number): GameState {
  let counts = countShortRangeCycleStart(runCountsOf(s), template);
  for (let i = 0; i < completed; i++) counts = countShortRangeCycleComplete(counts, template);
  return { ...s, runCounts: counts };
}

// The roll's sizes against its template's spans at `share`: inside [lo, spanTop], or exactly lo on the training run.
function expectWithinSpans(roll: ShortRangeRoll, spans: ShortRangeSpans, share: number, label: string): void {
  const check = (v: number | undefined, span: readonly [number, number] | undefined, what: string): void => {
    if (span === undefined) return expect(v, `${label} ${what}: not used`).toBeUndefined();
    expect(v, `${label} ${what}`).toBeGreaterThanOrEqual(span[0]);
    expect(v, `${label} ${what}`).toBeLessThanOrEqual(spanTop(span, share));
  };
  check(roll.distanceLy, spans.distanceLy, "distance");
  for (const k of SIZE_KEYS) check(roll[k], spans[k], k);
}

describe("SF-5 the G1 contract: every live short-range template stamps the shared difficulty", () => {
  it("covers every live template", () => {
    expect(SHORT_RANGE_TEMPLATE_KEYS.length).toBeGreaterThan(0);
    expect([...SHORT_RANGE_TEMPLATE_KEYS].sort()).toEqual(Object.keys(SHORT_RANGE_TEMPLATES).sort());
  });

  for (const template of SHORT_RANGE_TEMPLATE_KEYS) {
    for (const tier of TIERS) {
      it(`${template} at Tier ${tier === 1 ? "I" : "II"}: the training run is its smallest roll; later runs read the shared curve`, () => {
        const fresh = freshState();
        const spans = SHORT_RANGE_TEMPLATES[template].rolls[tier];
        const label = `${template} T${tier}`;

        // The training run: keyed per template, the stamp runDifficultyAt writes, every size at the bottom of its span.
        expect(isFirstRun(fresh, "shortRange", template), label).toBe(true);
        const training = rollOfTemplate(fresh, template, tier);
        expect(training.difficulty).toEqual(runDifficultyAt(fresh, "shortRange", tier, template));
        expect(training.difficulty).toEqual({ version: 1, firstRun: true, ramp: 0, tier });
        expect(isTrainingRoll(training)).toBe(true);
        expect(shortRangeSpanShare(training.difficulty)).toBe(0);
        expect(training.distanceLy, `${label} distance`).toBe(spans.distanceLy[0]);
        for (const k of SIZE_KEYS) if (spans[k] !== undefined) expect(training[k], `${label} ${k}`).toBe(spans[k]![0]);

        // Once started, no longer training; the curve reads its completed runs (the training run excluded), Tier I
        // only, and the share the roll may reach never falls as the curve climbs.
        let prevShare = -1;
        for (let c = 0; c <= N_FULL + 1; c++) {
          const s = afterRuns(fresh, template, c);
          expect(isFirstRun(s, "shortRange", template), `${label} c${c}`).toBe(false);
          const roll = rollOfTemplate(s, template, tier);
          expect(roll.difficulty).toEqual(runDifficultyAt(s, "shortRange", tier, template));
          expect(roll.difficulty.firstRun).toBe(false);
          const ramp = tier === 1 ? rampFraction(c) : 1;
          expect(roll.difficulty.ramp, `${label} c${c} ramp`).toBeCloseTo(runRamp(c, tier), 12);
          expect(roll.difficulty.ramp, `${label} c${c} ramp`).toBeCloseTo(ramp, 12);
          const share = shortRangeSpanShare(roll.difficulty);
          expect(share, `${label} c${c} share`).toBeCloseTo(rampEnemyScale(ramp), 12);
          expect(share, `${label} c${c} rises`).toBeGreaterThanOrEqual(prevShare);
          prevShare = share;
          expectWithinSpans(roll, spans, share, `${label} c${c}`);
        }
        expect(prevShare, `${label}: full from the top of the curve`).toBe(1);

        // Keyed per template: this template's runs leave every other template's training run in place.
        const started = afterRuns(fresh, template, 3);
        for (const other of SHORT_RANGE_TEMPLATE_KEYS) if (other !== template) expect(isFirstRun(started, "shortRange", other), `${label} -> ${other}`).toBe(true);
      });
    }
  }

  it("the live loop: every template's training run is dispatched, flown and delivered, never lost", () => {
    // A crewed Eir with a sensor array meets the Tier I sheet in every category (shortRangeBoard.test.ts).
    const eir = resolveCrew({ ...editShip(wiringBase(), { typeKey: "eir" }), gameTimeSeconds: 6 * 3600 });
    const base = installPiece(eir, { slotType: "sensor", moduleVariant: "sensorBalanced", implicitStats: { sensors: 20 } });
    const slot = shortRangeBoardSlots(base)[0];
    let s = base;
    for (const template of SHORT_RANGE_TEMPLATE_KEYS) {
      // The next cycle index on slot 0 that rolls this template, then a Dispatch Once run.
      let idx = 0;
      while (rollShortRangeJob(s, slot, idx).template !== template) idx += 1;
      const board = { version: 1 as const, nextCycle: { ...(s.shortRangeBoard?.nextCycle ?? {}), [slot.id]: idx } };
      const r = dispatchCaptainOnShortRange({ ...s, shortRangeBoard: board }, WIRING_CAPTAIN_ID, slot.id, false);
      expect(r.success, `${template}: ${String(r.reason)}`).toBe(true);
      s = r.next;
      const m = s.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!.mission as ShortRangeMissionState;
      expect(m.kind).toBe("shortRange");
      expect(m.roll.template).toBe(template);
      expect(m.roll.difficulty.firstRun, `${template}: its training run`).toBe(true);
      const key = `shortRange:${template}`;
      const before = Number(s.lifetimeStats.missionsCompleted[key] ?? 0);
      let ticks = 0;
      while (s.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!.mission !== null) {
        s = economyTick(s, 1, () => 0.5);
        if (++ticks > TICK_CAP) throw new Error(`${template}: never came home`);
      }
      expect(Number(s.lifetimeStats.missionsCompleted[key] ?? 0), `${template}: delivered`).toBe(before + 1);
      const captain = s.captains.find((c) => c.id === WIRING_CAPTAIN_ID)!;
      expect(captain.lastStopReason, template).not.toBe("defeat");
      expect(s.completionLog.some((e) => e.patrolEndReason === "defeat"), template).toBe(false);
      // The training run counts nowhere on the curve (SF5); the next run of this template is not a training run.
      expect(runCountsOf(s).shortRange[template]?.completed ?? 0, template).toBe(0);
      expect(isFirstRun(s, "shortRange", template), template).toBe(false);
    }
  });
});

// SF-7 close-out (the release gate): no wiring registry row waits on a safe first runs slice. Every SF row is live with
// a consumer, or deferred on the user's own words (away:audit:difficultyTiers: the objective affixes capture, 2026-10-14).
describe("SF-7: no registry row waits on a safe first runs slice", () => {
  it("no pending row names an SF slice as its owner", () => {
    const waiting = WIRING_REGISTRY.filter((e) => e.status.kind === "pending" && /\bSF-?\d/.test(e.status.owner)).map((e) => e.id);
    expect(waiting).toEqual([]);
    const tiers = WIRING_REGISTRY.find((e) => e.id === "away:audit:difficultyTiers")!;
    expect(tiers.status.kind).toBe("deferred");
    expect(tiers.status.kind === "deferred" && tiers.status.userRef).toMatch(/not focusing on higher difficulty tiers/);
  });
});
