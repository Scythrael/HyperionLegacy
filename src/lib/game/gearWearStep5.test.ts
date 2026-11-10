// GEAR WEAR step 5 (0.14.0, docs/plans/2026-10-16-gear-wear-design.md section 11 step 5, minus Quick Service per the
// user's 2026-11-09 answer): patrol use wear (each non-training cycle records its use), Overtime on gear repair (the
// speed seam's rule on a ship's docked gear recovery) and the wear UI's view models, all through the real engine.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import { type EquipmentInstance, type GameState, type PatrolMissionState } from "./model";
import { dispatchCaptainOnPatrol, economyTick } from "./tick";
import { CONDITION_FULL, REPAIR_RATES, USE_WEAR_FLOOR, pieceCondition, withPieceCondition } from "./gearWear";
import { gearOvertimeMult, gearRepairOutlook, livePieceCondition, patrolRouteLightYears } from "./gearWearEngine";
import {
  OVERTIME_CREDITS_PER_MINUTE,
  OVERTIME_MAX_STEPS,
  buyGearRepairOvertime,
  canBuyGearRepairOvertime,
  gearRepairOvertimeStepCost,
  gearRepairOvertimeTier,
  shipGearMinutesToFull,
} from "./processSpeed";
import { onHull } from "./firstRunsGoldens.fixture";
import { asPatrolVeteran } from "./awayTeamTestFixtures";
import { withPatrolUseWearOff } from "./patrolUseWearSwitch.fixture";
import { withBattleWearOff } from "./battleWearSwitch.fixture";
import { PATROLS } from "./model";
import { HELP_TOPICS, TRAINING_WEAR_SENTENCE } from "../helpTopics";
import { WIRING_REGISTRY } from "./wiring/registry";
import { GW5_PATROL_CONTEXT_IDS, gw5ReadBack } from "./gearWearStep5Registry.fixture";
import { WEAR_BANDS, aboutMinutes, conditionPercent, fleetCare, pieceWearCard, shipGearSummary, wearBand, wearEffectText } from "../gearWearDisplay";

const RNG = () => 0.5;
const SHIP = "ship-1";
const ROUTE = "crimsonReaverSweep" as const;

function veteran(): GameState {
  return asPatrolVeteran({ ...onHull("destroyer"), nextPatrolSeed: 1, credits: new Decimal(1_000_000) });
}

function stepped(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

function chunked(s: GameState, n: number, chunk: number): GameState {
  let out = s;
  let left = n;
  while (left > 0) {
    const k = Math.min(chunk, left);
    out = economyTick(out, k, RNG);
    left -= k;
  }
  return out;
}

const pieces = (s: GameState): EquipmentInstance[] => s.equipment.filter((e) => e.fittedToShipId === SHIP);
const slotCondition = (s: GameState, slot: string): number => pieceCondition(pieces(s).find((e) => e.slotType === slot)!);

function wornDocked(c: number): GameState {
  const s = veteran();
  return { ...s, equipment: s.equipment.map((e) => (e.fittedToShipId === SHIP ? withPieceCondition(e, c, s.gameTimeSeconds) : e)) };
}

describe("gear wear step 5: patrol use wear", () => {
  it("a patrol is stamped at dispatch and carries the stamp to every relaunch", () => {
    const r = dispatchCaptainOnPatrol(veteran(), 1, ROUTE, "balanced", true);
    expect((r.next.captains[0].mission as PatrolMissionState).useWear).toBe(1);
    const s = stepped(r.next, 40);
    const m = s.captains[0].mission as PatrolMissionState | null;
    if (m !== null) expect(m.useWear).toBe(1);
    expect(withPatrolUseWearOff(() => (dispatchCaptainOnPatrol(veteran(), 1, ROUTE, "balanced", true).next.captains[0].mission as PatrolMissionState).useWear)).toBeUndefined();
  });

  it("each cycle wears the reactor and the drive by use (battle wear off: nothing else touches them)", () => {
    // A Repeat patrol read the tick its 8th cycle starts (still out, so no home repair has run yet). A Sweep cycle is
    // 14 s, a quarter of a minute: its use carries from cycle to cycle until it is worth a whole per-mille.
    const fly = (off: boolean) =>
      withBattleWearOff(() => {
        const go = () => dispatchCaptainOnPatrol(veteran(), 1, ROUTE, "balanced", true);
        const r = off ? withPatrolUseWearOff(go) : go();
        let seed = (r.next.captains[0].mission as PatrolMissionState).masterSeed;
        let s = r.next;
        let cycles = 1;
        for (let t = 0; t < 4000 && cycles < 8; t++) {
          s = economyTick(s, 1, RNG);
          const m = s.captains[0].mission as PatrolMissionState | null;
          if (m === null) break;
          if (m.masterSeed !== seed) {
            seed = m.masterSeed;
            cycles += 1;
          }
        }
        expect(cycles).toBe(8);
        return s;
      });
    const on = fly(false);
    const off = fly(true);
    expect(slotCondition(off, "reactorCore")).toBe(CONDITION_FULL);
    expect(slotCondition(off, "ftlDrive")).toBe(CONDITION_FULL);
    expect(slotCondition(on, "reactorCore")).toBeLessThan(CONDITION_FULL);
    expect(slotCondition(on, "ftlDrive")).toBeLessThan(CONDITION_FULL);
    // Use wear never touches the weapons or the defenses, and never goes below the use floor.
    for (const slot of ["weapon", "shieldEmitters", "hullPlating", "cargoBay"]) expect(slotCondition(on, slot), slot).toBe(CONDITION_FULL);
    expect(slotCondition(on, "reactorCore")).toBeGreaterThan(USE_WEAR_FLOOR);
  });

  it("offline == live: one economyTick call == 997 s chunks == 1 s steps on a Repeat patrol", () => {
    const r = dispatchCaptainOnPatrol(veteran(), 1, ROUTE, "balanced", true);
    const N = 3000;
    const one = economyTick(r.next, N, RNG);
    const steps = stepped(r.next, N);
    const chunks = chunked(r.next, N, 997);
    expect(pieces(chunks)).toEqual(pieces(steps));
    expect(pieces(one)).toEqual(pieces(steps));
    expect(one.captains[0].mission).toEqual(steps.captains[0].mission);
    expect(chunks.captains[0].mission).toEqual(steps.captains[0].mission);
  });

  it("the route's distance is its authored round trip in light-years", () => {
    const def = PATROLS[ROUTE];
    expect(patrolRouteLightYears(def)).toBeCloseTo((def.transitOutTicks + def.transitBackTicks) * 0.5, 12);
  });
});

describe("gear wear step 5: Overtime on gear repair (the speed seam's rule)", () => {
  it("is refused while the ship is out, when nothing is worn, and at the maximum; priced 10 x job minutes x tier x step", () => {
    expect(canBuyGearRepairOvertime(veteran(), SHIP)).toEqual({ ok: false, reason: "nothingWorn" });
    expect(canBuyGearRepairOvertime(veteran(), "ship-nope")).toEqual({ ok: false, reason: "notFound" });
    const out = dispatchCaptainOnPatrol(wornDocked(700), 1, ROUTE, "balanced", false).next;
    expect(canBuyGearRepairOvertime(out, SHIP)).toEqual({ ok: false, reason: "notEligible" });
    let s = wornDocked(700);
    const job = shipGearMinutesToFull(s, SHIP, true)!;
    expect(job).toBeCloseTo(300 / REPAIR_RATES.home, 9);
    for (let step = 1; step <= OVERTIME_MAX_STEPS; step++) {
      const q = canBuyGearRepairOvertime(s, SHIP);
      expect(q.ok).toBe(true);
      if (!q.ok) return;
      expect(q.step).toBe(step);
      expect(q.cost).toBe(Math.ceil(OVERTIME_CREDITS_PER_MINUTE * job * gearRepairOvertimeTier(s, SHIP) * step));
      expect(q.cost).toBe(gearRepairOvertimeStepCost(s, SHIP, job, step));
      expect(q.minutesLeftAfter).toBeLessThan(q.minutesLeft);
      const before = s.credits;
      s = buyGearRepairOvertime(s, SHIP).next;
      expect(before.minus(s.credits).toNumber()).toBe(q.cost);
    }
    expect(canBuyGearRepairOvertime(s, SHIP)).toEqual({ ok: false, reason: "maxSteps" });
    const poor = { ...wornDocked(700), credits: new Decimal(0) };
    expect(canBuyGearRepairOvertime(poor, SHIP)).toMatchObject({ ok: false, reason: "credits" });
  });

  it("each step lifts the docked rate by 25% of normal (never doubling), and the record clears once the gear is full", () => {
    const base = wornDocked(500);
    const bought = buyGearRepairOvertime(base, SHIP).next;
    expect(gearOvertimeMult(bought, SHIP)).toBe(1.25);
    const piece = pieces(bought)[0];
    expect(gearRepairOutlook(bought, piece).ratePerMinute).toBeCloseTo(REPAIR_RATES.home * 1.25, 9);
    expect(gearRepairOutlook(bought, piece, true).ratePerMinute).toBeCloseTo(REPAIR_RATES.home, 9);
    const sixty = (s: GameState) => slotCondition(stepped(s, 60 / s.tickDurationSeconds), "reactorCore");
    expect(sixty(bought) - 500).toBe(Math.floor(REPAIR_RATES.home * 1.25));
    expect(sixty(base) - 500).toBe(REPAIR_RATES.home);
    let maxed = base;
    for (let i = 0; i < OVERTIME_MAX_STEPS; i++) maxed = buyGearRepairOvertime(maxed, SHIP).next;
    expect(gearOvertimeMult(maxed, SHIP)).toBeLessThan(2);
    const full = stepped(bought, Math.ceil((600 / (REPAIR_RATES.home * 1.25)) * 60) / bought.tickDurationSeconds + 2);
    expect(pieces(full).every((p) => p.condition === undefined)).toBe(true);
    expect(full.ships[0].gearRepairSpeed).toBeUndefined();
  });

  it("offline == live with Overtime: one call == 997 s chunks == 1 s steps, at every step count", () => {
    // Conditions are exact; an anchor at a rate like 50 a minute (1.2 s a per-mille) can differ by float noise only.
    const same = (a: GameState, b: GameState) => {
      const pa = pieces(a);
      const pb = pieces(b);
      expect(pa.map((p) => p.condition)).toEqual(pb.map((p) => p.condition));
      pa.forEach((p, i) => expect(Math.abs((p.conditionAt ?? 0) - (pb[i].conditionAt ?? 0))).toBeLessThan(1e-6));
      expect(a.ships[0].gearRepairSpeed).toEqual(b.ships[0].gearRepairSpeed);
    };
    for (let steps = 1; steps <= OVERTIME_MAX_STEPS; steps++) {
      let bought = wornDocked(300);
      for (let i = 0; i < steps; i++) bought = buyGearRepairOvertime(bought, SHIP).next;
      for (const N of [137, 500, 1100]) {
        const live = stepped(bought, N);
        same(economyTick(bought, N, RNG), live);
        same(chunked(bought, N, 997), live);
      }
    }
  });

  it("is inert out on a run and clears when the ship leaves", () => {
    const bought = buyGearRepairOvertime(wornDocked(700), SHIP).next;
    const out = dispatchCaptainOnPatrol(bought, 1, ROUTE, "balanced", false).next;
    const piece = pieces(out)[0];
    expect(gearRepairOutlook(out, piece).ratePerMinute).toBeLessThan(REPAIR_RATES.home);
    expect(economyTick(out, 1, RNG).ships[0].gearRepairSpeed).toBeUndefined();
  });
});

describe("gear wear step 5: the registry move is exactly its own", () => {
  it("Quick Service's row is gone, Overtime on gear repair is live, the five time and distance use sources act on a patrol", () => {
    expect(WIRING_REGISTRY.some((e) => e.id === "wear:audit:quickGearRepair")).toBe(false);
    expect(WIRING_REGISTRY.find((e) => e.id === "wear:audit:gearRepairOvertime")?.status.kind).toBe("live");
    for (const id of GW5_PATROL_CONTEXT_IDS) {
      const e = WIRING_REGISTRY.find((x) => x.id === id)!;
      expect(e.status.kind, id).toBe("live");
      expect(e.contexts, id).toContain("patrol");
    }
    // Read back, every changed row is as step 4 left it (the earlier registry pins use gw5ReadBack, innermost).
    const back = gw5ReadBack(WIRING_REGISTRY);
    expect(back.find((e) => e.id === "wear:audit:quickGearRepair")?.status.kind).toBe("pending");
    expect(back.find((e) => e.id === "wear:audit:gearRepairOvertime")?.status.kind).toBe("pending");
    expect(back.length).toBe(WIRING_REGISTRY.length + 1);
  });
});

describe("gear wear step 5: the wear UI's view models read the engine", () => {
  it("bands: Pristine 95+, Sound 80+, Worn from the use floor, Battered below it; percent rounds down", () => {
    expect(WEAR_BANDS.find((b) => b.key === "worn")?.min).toBe(USE_WEAR_FLOOR);
    expect(wearBand(1000).name).toBe("Pristine");
    expect(wearBand(949).name).toBe("Sound");
    expect(wearBand(USE_WEAR_FLOOR).name).toBe("Worn");
    expect(wearBand(USE_WEAR_FLOOR - 1).name).toBe("Battered");
    expect(conditionPercent(999)).toBe(99);
    expect(aboutMinutes(0.2)).toBe("about 1 min");
    expect(aboutMinutes(80)).toBe("about 1 h 20 min");
  });

  it("the card: band, effect from the curve, worn lines, and the care footer from the repair outlook", () => {
    const s = wornDocked(780);
    const cargo = pieces(s).find((p) => p.slotType === "cargoBay")!;
    const card = pieceWearCard(s, cargo);
    expect(card.lead).toBe("Worn 78%.");
    expect(card.effect).toBe("Its stat lines work at 98.8% of new.");
    expect(card.wearsBy).toBe("hauls");
    expect(card.lines.every((l) => l.now < l.was)).toBe(true);
    expect(card.care).toBe(`Back to full in ${aboutMinutes(220 / REPAIR_RATES.home)} at home, on its own. No cost, no button.`);
    expect(wearEffectText("weapon", 640)).toBe("Opens each fight at 64%.");
    expect(wearEffectText("reactorCore", 640)).toBe("Each fight opens it at 64%. Its power output stays full.");
    const pristine = pieceWearCard(veteran(), pieces(veteran())[0]);
    expect(pristine.lead).toBe("Pristine.");
    expect(pristine.care).toBe("Nothing to do.");
  });

  it("the Help topic reads the engine: bands, the use floor, the curve, the free rates; no paid or instant repair", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "gearWear")!;
    expect(topic.title).toBe("Gear wear");
    for (const s of ["Pristine (95% and up)", "Sound (80% to 94%)", "Worn (60% to 79%)", "Battered (below 60%)", "Ordinary use stops at 60%", "96% at 60%", "never below 75%", "4% a minute at home", "8% a minute while its hull is in a Shipyard repair bay", "0.2% a minute out on a run", "no button and no cost"]) {
      expect(topic.body, s).toContain(s);
    }
    expect(topic.body).toContain(TRAINING_WEAR_SENTENCE);
    expect(topic.body).not.toMatch(/Quick Service|instant|pay/i);
    expect(topic.body).not.toMatch(/—|--/);
  });

  it("the ship header and the fleet care line: hidden when pristine, report docked recovery and out-on-a-run truthfully", () => {
    expect(fleetCare(veteran())).toBeNull();
    expect(shipGearSummary(veteran(), SHIP).recovery).toBeNull();
    const s = wornDocked(700);
    const summary = shipGearSummary(s, SHIP);
    expect(summary.percent).toBe(70);
    expect(summary.recovery).toBe(`Recovering, full in ${aboutMinutes(300 / REPAIR_RATES.home)}`);
    const care = fleetCare(s)!;
    expect(care.rows).toHaveLength(1);
    expect(care.summary).toBe(`1 ship recovering. Docked gear back to full in ${aboutMinutes(300 / REPAIR_RATES.home)}.`);
    const out = dispatchCaptainOnPatrol(s, 1, ROUTE, "balanced", false).next;
    expect(fleetCare(out)!.rows[0].status).toBe("Out on a run, gear recovers slowly underway and fully once home");
    expect(livePieceCondition(out, pieces(out)[0])).toBe(700);
  });
});
