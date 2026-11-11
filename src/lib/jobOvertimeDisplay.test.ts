// OT-UI (0.14.0): the job Overtime strip's view model (jobOvertimeDisplay.ts), against the approved 2026-11-10 Overtime
// buttons mockup's sample numbers (the engine's rule on real catalog data at the 1 s tick): a 10 min Destroyer build at
// Tier 2 costs 200 / 400 / 600 cr and 06:00 left becomes 04:48; the states buy, credits, paused, max and hidden.

import { describe, it, expect } from "vitest";
import Decimal from "break_infinity.js";
import { freshState, type GameState, type ProcessEffect, type TimedProcess, type TimedProcessKind } from "./game/model";
import { economyTick, startProcess, tick } from "./game/tick";
import { buildHomeDashboard } from "./game/homeDashboard";
import { formatClock } from "./game/format";
import { setDataStudyPaused } from "./game/dataStudy";
import { OVERTIME_PROCESS_KINDS, buyOvertime } from "./game/processSpeed";
import { tierNumeral } from "./game/galaxy";
import { jobLengthText, jobOvertimePurchase, jobOvertimeStrip, jobRateText, jobSubject, overtimeElapsedText } from "./jobOvertimeDisplay";

const RNG = () => 0.5;
const clock = (ticks: number) => formatClock(ticks, 1);

function withJob(kind: TimedProcessKind, ticks: number, effect: ProcessEffect, credits = 1_000_000): { s: GameState; id: string } {
  const base: GameState = { ...freshState(), credits: new Decimal(credits) };
  const r = startProcess(base, kind, {}, ticks, effect);
  expect(r.started).toBe(true);
  return { s: r.next, id: r.next.activeProcesses[r.next.activeProcesses.length - 1].id };
}

function job(s: GameState, id: string): TimedProcess {
  return s.activeProcesses.find((p) => p.id === id)!;
}

function step(s: GameState, n: number): GameState {
  let out = s;
  for (let i = 0; i < n; i++) out = economyTick(out, 1, RNG);
  return out;
}

const DESTROYER: ProcessEffect = { type: "addShip", typeKey: "destroyer" };

describe("the strip, as the mockup draws it", () => {
  it("A, can buy (0 of 3): the exact cost, the new time in the row's clock, the pricing line from the engine rule", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    const s = step(start, 240); // 06:00 left
    const strip = jobOvertimeStrip(s, job(s, id), clock)!;
    expect(strip.state).toBe("buy");
    expect(strip.steps).toBe(0);
    expect(strip.rateText).toBeNull();
    expect(strip.cost).toBe(200);
    expect(strip.button).toBe("+25% · 200 cr");
    expect(strip.when).toEqual({ lead: "Done in", time: "04:48", was: "06:00" });
    expect(strip.note).toBe("Optional. Priced on the whole 10 min build at Tier II");
    expect(strip.noteTail).toBe(", so a step costs the same whenever you buy it");
  });

  it("B, after steps: the rate, the next step's exact cost (rising per step), 'Next step: done in'", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    let s = buyOvertime(step(start, 100), { kind: "process", id }).next;
    s = buyOvertime(s, { kind: "process", id }).next;
    const strip = jobOvertimeStrip(s, job(s, id), clock)!;
    expect(strip.steps).toBe(2);
    expect(strip.rateText).toBe("1.5x");
    expect(strip.cost).toBe(600);
    expect(strip.when?.lead).toBe("Next step: done in");
    expect(strip.note).toBe("Priced on the whole 10 min build at Tier II.");
    expect(strip.noteTail).toBe("");
    expect(jobRateText(job(s, id))).toBe("1.5x");
  });

  it("C, short of credits: the exact price and exactly what is missing, the job's time unchanged", () => {
    const { s, id } = withJob("shipBuild", 600, DESTROYER, 150);
    const strip = jobOvertimeStrip(s, job(s, id), clock)!;
    expect(strip.state).toBe("credits");
    expect(strip.button).toBe("200 cr · need 50 more");
    expect(strip.need).toBe(50);
    expect(strip.when).toEqual({ lead: "Done in", time: "10:00", was: null });
  });

  it("D, a data study while auto-study is off: Paused, with its reason (the engine's 'paused')", () => {
    const { s, id } = withJob("dataStudy", 1200, { type: "studyData", itemId: "propulsionData", studyIndex: 1 });
    const paused = setDataStudyPaused(s, true);
    const strip = jobOvertimeStrip(paused, job(paused, id), clock)!;
    expect(strip.state).toBe("paused");
    expect(strip.button).toBe("Paused");
    expect(strip.why).toContain("Auto-study is off");
    expect(strip.when).toBeNull();
    // A data study is priced at Tier 1 (the engine's overtimeTier has no branch for it): 20 min x 10 = 200 cr.
    expect(jobOvertimeStrip(s, job(s, id), clock)!.cost).toBe(200);
  });

  it("E, at the maximum: At its fastest, the time left, no button", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    let s = start;
    for (let i = 0; i < 3; i++) s = buyOvertime(s, { kind: "process", id }).next;
    const strip = jobOvertimeStrip(s, job(s, id), clock)!;
    expect(strip.state).toBe("max");
    expect(strip.button).toBeNull();
    expect(strip.rateText).toBe("1.75x");
    expect(strip.when?.lead).toBe("Done in");
  });

  it("hidden on a job's last tick, on a kind Overtime is not offered on", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    const last = step(start, 599);
    expect(jobOvertimeStrip(last, job(last, id), clock)).toBeNull();
    const refine = withJob("refineJob", 600, { type: "addItem", itemId: "frameSegment", amount: new Decimal(1) });
    expect(jobOvertimeStrip(refine.s, job(refine.s, refine.id), clock)).toBeNull();
  });

  it("the repair banner speaks 'Repaired in'; facility rungs name the level being built; the telescope's rung is a cycle; level-less rungs read a bare tier", () => {
    const base = { ...freshState(), credits: new Decimal(1_000_000) };
    const damaged = { ...base, ships: base.ships.map((sh) => ({ ...sh, damaged: true, repairDamage: 100 })) };
    const rep = startProcess(damaged, "shipRepair", {}, 320, { type: "clearShipDamage", shipId: damaged.ships[0].id }).next;
    const rp = rep.activeProcesses[rep.activeProcesses.length - 1];
    expect(jobOvertimeStrip(rep, rp, clock)!.when?.lead).toBe("Repaired in");
    expect(jobOvertimeStrip(rep, rp, clock)!.note).toContain("5 min 20 s repair");
    const docks = withJob("docksExpansion", 360, { type: "docksCapacityUp" });
    // The Docks, docking bays and Systems Bay have no level: their tier is the expansion's number, said bare (the
    // approved mockup). The engine rule: processSpeed.ts overtimeTier.
    const docksNote = jobOvertimeStrip(docks.s, job(docks.s, docks.id), clock)!.note;
    expect(docksNote).toBe("Optional. Priced on the whole 6 min rung at Tier I");
    const bay = withJob("transitBerthExpansion", 360, { type: "transitBerthLevelUp" });
    const bayNote = jobOvertimeStrip(bay.s, job(bay.s, bay.id), clock)!.note;
    expect(bayNote).toBe(`Optional. Priced on the whole 6 min rung at Tier ${tierNumeral((bay.s.transitBerthCapacity ?? 0) + 1)}`);
    const sys = withJob("equipmentStorageUpgrade", 360, { type: "equipmentStorageLevelUp" });
    const sysNote = jobOvertimeStrip(sys.s, job(sys.s, sys.id), clock)!.note;
    expect(sysNote).toBe(`Optional. Priced on the whole 6 min rung at Tier ${tierNumeral(sys.s.equipmentStorageLevel + 1)}`);
    const fac = withJob("facilityUpgrade", 360, { type: "facilityLevelUp", facility: "refinery" });
    expect(jobOvertimeStrip(fac.s, job(fac.s, fac.id), clock)!.note).toContain(
      `6 min rung at Tier ${tierNumeral((fac.s.facilities.refinery?.level ?? 0) + 1)} (level ${(fac.s.facilities.refinery?.level ?? 0) + 1} being built)`,
    );
    const tel = withJob("facilityUpgrade", 720, { type: "facilityLevelUp", facility: "subspaceTelescope" });
    expect(jobOvertimeStrip(tel.s, job(tel.s, tel.id), clock)!.note).toContain(
      `12 min cycle at Tier ${tierNumeral((tel.s.facilities.subspaceTelescope?.level ?? 0) + 1)} (the cycle being run)`,
    );
    expect(jobSubject(tel.s, job(tel.s, tel.id))).toMatch(/^the Subspace Telescope cycle \d+$/);
  });

  it("every kind Overtime is offered on draws a strip", () => {
    const effects: Partial<Record<TimedProcessKind, ProcessEffect>> = {
      shipBuild: DESTROYER,
      researchProject: { type: "unlockBlueprint", key: "frameSegmentBp" },
      dataStudy: { type: "studyData", itemId: "propulsionData", studyIndex: 1 },
      facilityUpgrade: { type: "facilityLevelUp", facility: "refinery" },
      docksExpansion: { type: "docksCapacityUp" },
      transitBerthExpansion: { type: "transitBerthLevelUp" },
      equipmentStorageUpgrade: { type: "equipmentStorageLevelUp" },
    };
    for (const kind of OVERTIME_PROCESS_KINDS) {
      if (kind === "shipRepair") continue; // covered above (needs a damaged hull)
      const { s, id } = withJob(kind, 600, effects[kind]!);
      expect(jobOvertimeStrip(s, job(s, id), clock)?.state, kind).toBe("buy");
    }
  });
});

describe("one tap: the engine's buy and its System Log line", () => {
  it("charges the quoted cost and logs the step, the price and the new time", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    const s = step(start, 240);
    const r = jobOvertimePurchase(s, id, clock);
    expect(r.bought).toBe(true);
    expect(s.credits.minus(r.next.credits).toNumber()).toBe(200);
    expect(r.log).toBe("Overtime on the Destroyer build: step 1 of 3 for 200 cr. Done in 04:48.");
    expect(job(r.next, id).speed?.overtimeSteps).toBe(1);
  });

  it("a refusal changes nothing and logs nothing", () => {
    const { s, id } = withJob("shipBuild", 600, DESTROYER, 10);
    const r = jobOvertimePurchase(s, id, clock);
    expect(r).toEqual({ next: s, bought: false, log: null });
  });
});

describe("Command Home: the rate chip only, and both times on the completed row", () => {
  it("an in-progress row carries the rate chip once a step is bought, and its bar holds at the purchase", () => {
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    const s = step(start, 240);
    const before = buildHomeDashboard(s).inProgress.find((r) => r.id === id)!;
    expect("rateText" in before).toBe(false);
    const sped = buyOvertime(s, { kind: "process", id }).next;
    const after = buildHomeDashboard(sped).inProgress.find((r) => r.id === id)!;
    expect(after.rateText).toBe("1.25x");
    expect(after.progress).toBeCloseTo(before.progress, 12);
    expect(after.remainingTicks).toBe(288);
  });

  it("a completed row carries the Overtime record; one without Overtime carries none", () => {
    const T0 = 1_800_000_000_000;
    const { s: start, id } = withJob("shipBuild", 600, DESTROYER);
    let s = tick(100, start, RNG, T0 + 100_000);
    s = buyOvertime(s, { kind: "process", id }).next;
    s = tick(400, s, RNG, T0 + 500_000);
    const row = buildHomeDashboard(s).recentlyCompleted[0];
    expect(row.overtime).toEqual({ steps: 1, normalMs: 600_000 });
    expect(row.elapsedMs).toBe(500_000);
    expect(overtimeElapsedText("08:20", "10:00")).toEqual({ took: "took 08:20 with Overtime", normal: "(10:00 at the normal rate)" });
    const plain = tick(600, withJob("shipBuild", 600, DESTROYER).s, RNG, T0 + 600_000);
    expect("overtime" in buildHomeDashboard(plain).recentlyCompleted[0]).toBe(false);
  });
});

describe("long jobs: the log lines read hours and days", () => {
  const T0 = 1_800_000_000_000;

  it("a 3 h build: the purchase line and the completed row's both times read H:MM:SS", () => {
    const { s: start, id } = withJob("shipBuild", 10_800, DESTROYER);
    let s = tick(3_600, start, RNG, T0 + 3_600_000); // 2:00:00 left
    const p = job(s, id);
    expect(jobOvertimeStrip(s, p, clock)!.note).toBe("Optional. Priced on the whole 3 h build at Tier II");
    const r = jobOvertimePurchase(s, p.id, clock);
    expect(r.bought).toBe(true);
    expect(r.log).toMatch(/^Overtime on the Destroyer build: step 1 of 3 for .+ cr\. Done in 1:36:00\.$/);
    s = tick(5_760, r.next, RNG, T0 + 9_360_000);
    const row = buildHomeDashboard(s).recentlyCompleted[0];
    expect(row.overtime).toEqual({ steps: 1, normalMs: 10_800_000 });
    expect(row.elapsedMs).toBe(9_360_000);
    expect(overtimeElapsedText(clock(row.elapsedMs! / 1000), clock(row.overtime!.normalMs / 1000))).toEqual({
      took: "took 2:36:00 with Overtime",
      normal: "(3:00:00 at the normal rate)",
    });
  });

  it("a 2 day project: the purchase line and the completed row's both times read days", () => {
    const { s: start, id } = withJob("researchProject", 172_800, { type: "unlockBlueprint", key: "frameSegmentBp" });
    let s = tick(2_800, start, RNG, T0 + 2_800_000); // 170,000 s left
    const p = job(s, id);
    expect(jobOvertimeStrip(s, p, clock)!.note).toContain("Priced on the whole 48 h project at Tier ");
    const r = jobOvertimePurchase(s, p.id, clock);
    expect(r.bought).toBe(true);
    expect(r.log).toMatch(/^Overtime on the .+ project: step 1 of 3 for .+ cr\. Done in 1d 13:46:40\.$/); // 136,000 s
    s = tick(136_000, r.next, RNG, T0 + 138_800_000);
    const row = buildHomeDashboard(s).recentlyCompleted[0];
    expect(row.overtime).toEqual({ steps: 1, normalMs: 172_800_000 });
    expect(row.elapsedMs).toBe(138_800_000);
    expect(overtimeElapsedText(clock(row.elapsedMs! / 1000), clock(row.overtime!.normalMs / 1000))).toEqual({
      took: "took 1d 14:33:20 with Overtime",
      normal: "(2d 00:00:00 at the normal rate)",
    });
  });
});

describe("the job's length text", () => {
  it("reads minutes and seconds the way the mockup prints them", () => {
    expect(jobLengthText(600)).toBe("10 min");
    expect(jobLengthText(320)).toBe("5 min 20 s");
    expect(jobLengthText(45)).toBe("45 s");
    expect(jobLengthText(8100)).toBe("2 h 15 min");
  });
});
