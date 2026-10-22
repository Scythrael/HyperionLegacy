// Squads SQ-6 follow-up (user, 2026-10-13: Strike's role, "BOTH"): CLEARING TASKS, Security-only work at
// dangerous sites (riskFactors.ts CLEARING_SITE_RULES). This file pins that a risk-aware run whose bodies carry no
// clearing roll (every run dispatched before the follow-up) resolves exactly as before (goldens captured BEFORE the
// change), then the clearing rules: the roll, the stamping, the labels, Strike alone, Survey never.

import { describe, expect, it } from "vitest";
// GEAR WEAR step 3: this file's pins were captured before the use wear engine; it runs with the use sources off
// (gearWearSwitch.fixture.ts), so they keep proving nothing else moved. gearWearGoldens.test.ts pins the wear.
import { gearWearOffInThisFile } from "./gearWearSwitch.fixture";
gearWearOffInThisFile();
import { freshState, type AwayMember, type Expedition, type GameState, type ShipGroundTeam } from "./model";
import { TRANSIT_SECONDS, advanceExpedition, claimExpedition, startExpedition, systemTaskPreview } from "./expedition";
import { CLEARING_SITE_RULES, bodyRiskGrades, generateRiskProfile, isClearingSiteId, type ExpeditionRegion } from "./riskFactors";
import { riskFightPointCount } from "./groundTasks";
import { groundOpsLogText } from "./groundOps";
import { CLEARING_SITE_CATALOG, POI_CATALOG, PLANET_TYPES, groundSiteLabel, poisForPlanetType } from "./expeditionContent";
import { generateEncounter } from "./gambit";
import { asPreG2NamesDispatch, plainAwayMember, withoutAffixes, withoutShipEvents } from "./awayTeamTestFixtures";
// SF-1: the claimed state hashes without the run counters (a claim writes them), absent before SF-1.
import { withoutRunCounts, goldenJson } from "./firstRunsGoldens.fixture";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

const T0 = 100_000;
// The instant the bodies are scanned: the outbound transit (the regular one since safe first runs SF-2 retired the 30
// minute shakedown) plus the 28,200 s of scanning these tests always gave.
const SCANNED_AT = T0 + TRANSIT_SECONDS + 28_200;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1: Ground + Ground fully slotted, rank 6 (runs finish on calm worlds and struggle on dangerous ones).
function crewed(expeditionSeed: number, kinds: "gg" | "ss" = "gg"): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 6 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] =
    kinds === "gg"
      ? [
          { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
          { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
        ]
      : [
          { kind: "strike", security: SEC.slice(), science: [], helpOthers: false },
          { kind: "survey", security: [], science: SCI.slice(), helpOthers: false },
        ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed,
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

// The run as it was dispatched before the follow-up: no body carries a clearing roll. (Before the change the
// stored risk had no `clearing` key, so this is a no-op on the pre-change code.)
// Ground Ops GO-8: a run dispatched before the follow-up never had ship events either (withoutShipEvents).
// Objective affixes (AF-1): nor the affix flag (withoutAffixes).
export function withoutClearing(exp: Expedition): Expedition {
  return {
    ...withoutShipEvents(withoutAffixes(exp)),
    bodies: exp.bodies.map((b) => {
      if (!b.risk) return b;
      const risk = { ...b.risk };
      delete risk.clearing;
      return { ...b, risk };
    }),
  };
}

// Dispatch candidate 0, optionally on a forced region (the risk replaced before any body scans).
function dispatch(state: GameState, region?: ExpeditionRegion, candidateId = "cand-0"): { next: GameState; exp: Expedition } {
  const res = asPreG2NamesDispatch(startExpedition(state, "ship-1", 1, candidateId));
  expect(res.success, String(res.reason)).toBe(true);
  let exp = res.expedition!;
  if (region) {
    const forced = generateRiskProfile(exp.seed, region, exp.bodies);
    exp = { ...exp, risk: forced.profile, bodies: exp.bodies.map((b, i) => ({ ...b, risk: forced.bodies[i] })) };
  }
  return { next: res.next, exp };
}

describe("pre-clearing runs resolve exactly as before (goldens captured BEFORE the follow-up)", () => {
  const CASES: Record<string, () => { state: GameState; region?: ExpeditionRegion }> = {
    tierOne: () => ({ state: crewed(0x0a13bd4) }),
    tierThree: () => ({ state: crewed(0x1259124), region: { tier: 3, enemyTerritory: false } }),
    tierFourEnemy: () => ({ state: crewed(0x0a13bd4), region: { tier: 4, enemyTerritory: true } }),
    strikeSurveyTierFour: () => ({ state: crewed(0x3c0ffee, "ss"), region: { tier: 4, enemyTerritory: true } }),
  };
  // Captured from the code BEFORE the follow-up (commit 7cb32be): five checkpoints, the phase at 2,000,000 s, the
  // claim (when the run completes).
  const GOLDEN: Record<string, string[]> = {
    tierOne: ["1a2c133a", "d90c6896", "87a5a1db", "6066182d", "3bca6243", "activities", "unclaimed"],
    tierThree: ["d00662f8", "ae1a27d0", "ae1a27d0", "ae1a27d0", "ae1a27d0", "complete", "6fea8ae1"],
    tierFourEnemy: ["540ccc7b", "eafb3f06", "217cef30", "217cef30", "217cef30", "complete", "c2e99db7"],
    strikeSurveyTierFour: ["2dcedd6d", "e0f5ebfc", "e0f5ebfc", "e0f5ebfc", "e0f5ebfc", "complete", "7acaa969"],
  };
  for (const [name, build] of Object.entries(CASES)) {
    it(`${name}: checkpoints and the claim match the pre-clearing capture`, { timeout: 120_000 }, () => {
      const { state, region } = build();
      const d = dispatch(state, region);
      const exp = withoutClearing(d.exp);
      const hashes = [T0 + 5000, T0 + 20000, T0 + 60000, T0 + 150000, T0 + 400000].map((t) => fnv(goldenJson(advanceExpedition(exp, t))));
      const done = advanceExpedition(exp, T0 + 2_000_000);
      hashes.push(done.phase);
      const claimed = done.phase === "complete" ? claimExpedition({ ...d.next, expeditions: [done] }, done.id) : null;
      hashes.push(claimed ? fnv(goldenJson(withoutRunCounts(claimed.next))) : "unclaimed");
      expect(hashes).toEqual(GOLDEN[name]);
    });
  }
});

// ===== The clearing tasks =====

const TIER4E: ExpeditionRegion = { tier: 4, enemyTerritory: true };
const clearingTasks = (exp: Expedition) =>
  exp.bodies.flatMap((b, bodyIndex) => b.activities.filter((t) => isClearingSiteId(t.poiId)).map((task) => ({ task, body: b, bodyIndex })));

describe("clearing tasks: the roll (riskFactors.ts CLEARING_SITE_RULES)", () => {
  it("is never drawn below a Moderate driver grade, and grows with the grade", () => {
    const rate = (combat: number, fauna: number): [number, number] => {
      let clear = 0;
      let lz = 0;
      for (let seed = 0; seed < 3000; seed++) {
        const system = { combat: combat as 0, fauna: fauna as 0, flora: 0 as const };
        const g = bodyRiskGrades(seed * 7919, { tier: 4, enemyTerritory: false }, system, 0, { planetType: "terrestrial", hazard: 0 });
        // The jitter can drop a grade one step; the roll reads the drawn grade.
        if (g.combat < 2) expect(g.clearing?.includes("clearHostiles") ?? false).toBe(false);
        if (g.fauna < 2) expect(g.clearing?.includes("secureLandingZone") ?? false).toBe(false);
        if (g.clearing?.includes("clearHostiles")) clear += 1;
        if (g.clearing?.includes("secureLandingZone")) lz += 1;
      }
      return [clear / 3000, lz / 3000];
    };
    expect(rate(1, 1)).toEqual([0, 0]);
    const [moderate] = rate(2, 0);
    const [extreme] = rate(4, 0);
    expect(extreme).toBeGreaterThan(moderate);
    // Extreme: 70% stay Extreme (900 per 1000) and 30% drop to High (600): about 0.81.
    expect(extreme).toBeGreaterThan(0.77);
    expect(extreme).toBeLessThan(0.85);
    expect(rate(0, 4)[1]).toBeGreaterThan(0.55);
    expect(CLEARING_SITE_RULES.clearHostiles.driver).toBe("combat");
    expect(CLEARING_SITE_RULES.secureLandingZone.driver).toBe("fauna");
  });

  it("never puts a landing-zone task on a lifeless world (no fauna there), and stays out of every discovery pool", () => {
    for (let seed = 0; seed < 500; seed++) {
      const g = bodyRiskGrades(seed, { tier: 7, enemyTerritory: true }, { combat: 4, fauna: 4, flora: 4 }, 0, { planetType: "barren", hazard: 0 });
      expect(g.clearing?.includes("secureLandingZone") ?? false).toBe(false);
    }
    const ids = CLEARING_SITE_CATALOG.map((d) => d.id);
    expect(ids).toEqual(["clearHostiles", "secureLandingZone"]);
    for (const id of ids) {
      expect(POI_CATALOG.some((p) => (p.id as string) === id)).toBe(false);
      for (const planet of PLANET_TYPES) {
        const pools = poisForPlanetType(planet.id);
        expect([...pools.surface, ...pools.underground].some((w) => (w.poi.id as string) === id)).toBe(false);
      }
    }
  });

  it("is labeled and guarded", () => {
    expect(groundSiteLabel("clearHostiles")).toBe("Clear the Hostiles");
    expect(groundSiteLabel("secureLandingZone")).toBe("Secure the Landing Zone");
    expect(generateEncounter(5, 0, "clearHostiles").map((e) => e.role)).toEqual(["striker", "striker", "bruiser"]);
    expect(generateEncounter(5, 0, "secureLandingZone").map((e) => e.role)).toEqual(["swarm", "swarm", "bruiser"]);
  });
});

describe("clearing tasks: stamping and planning", () => {
  const seedAt = (k: number) => (0x5eed + k * 977) >>> 0;

  // 20 dispatches scanned through: slow on a loaded machine (it timed out at the 5 s default before SF-2 too).
  it("at a forced Tier IV: Security-only needs from the risk-aware fight count, rated, 2 Security squads from 4 fights", { timeout: 30_000 }, () => {
    let seen = 0;
    let two = 0;
    for (let k = 0; k < 20; k++) {
      const d = dispatch(crewed(seedAt(k)), TIER4E, "cand-4-0"); // G2-2: the Tier IV candidate (its bodies grow with the tier)
      const scanned = advanceExpedition(d.exp, SCANNED_AT);
      for (const { task, body } of clearingTasks(scanned)) {
        seen += 1;
        const fights = riskFightPointCount(task.poiId, body.hazard, body.risk!);
        expect(fights).toBeGreaterThanOrEqual(1);
        expect(task.fightPoints).toHaveLength(fights);
        expect(task.needs).toEqual({ security: fights >= 4 ? 2 : 1, science: 0 });
        expect(task.difficulty).toBeGreaterThanOrEqual(1);
        if (task.needs!.security === 2) two += 1;
      }
      // preview == run, clearing tasks included
      const preview = systemTaskPreview(d.exp.seed, d.exp.scanParams, TIER4E);
      expect(preview.tasks.filter((t) => isClearingSiteId(t.poiId)).map((t) => [t.bodyIndex, t.poiId, t.needs])).toEqual(
        clearingTasks(scanned).map(({ task, bodyIndex }) => [bodyIndex, task.poiId, task.needs]),
      );
    }
    expect(seen).toBeGreaterThan(5);
    expect(two).toBeGreaterThan(0);
  });

  it("at Tiers I and II a clearing task never asks for more than one Security squad (safe tiers adapt)", { timeout: 30_000 }, () => {
    for (const tier of [1, 2] as const) {
      let seen = 0;
      for (let k = 0; k < 30; k++) {
        const d = dispatch(crewed((0xabc + k * 131) >>> 0), { tier, enemyTerritory: true });
        for (const { task } of clearingTasks(advanceExpedition(d.exp, SCANNED_AT))) {
          seen += 1;
          expect(task.needs).toEqual({ security: 1, science: 0 });
        }
      }
      expect(seen, `tier ${tier}`).toBeGreaterThan(0);
    }
  });

  it("a Strike team takes a clearing task ALONE; a Survey team never does", () => {
    let seen = 0;
    for (let k = 0; k < 20; k++) {
      const scanned = advanceExpedition(dispatch(crewed(seedAt(k), "ss"), TIER4E).exp, SCANNED_AT);
      const strike = scanned.groundOps!.teams.find((t) => t.kind === "strike")!;
      const survey = scanned.groundOps!.teams.find((t) => t.kind === "survey")!;
      for (const { task } of clearingTasks(scanned)) {
        seen += 1;
        expect(task.assignedTeamIds).toEqual([strike.index]);
        expect(survey.queue).not.toContain(task.id);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("from Tier III, one Ground team skips a 2-Security clearing task with a named log line", () => {
    for (let k = 0; k < 40; k++) {
      const base = crewed(seedAt(k));
      const emptyBravo: ShipGroundTeam = { kind: "ground", security: [null, null, null], science: [null, null, null], helpOthers: false };
      const one: GameState = { ...base, ships: base.ships.map((sh) => ({ ...sh, groundTeams: [sh.groundTeams![0], emptyBravo] })) };
      const scanned = advanceExpedition(dispatch(one, TIER4E).exp, SCANNED_AT);
      const big = clearingTasks(scanned).find(({ task }) => task.needs!.security === 2);
      if (!big) continue;
      expect(big.task.status).toBe("skipped");
      const entry = scanned.groundOps!.log!.find((e) => e.taskId === big.task.id)!;
      expect(groundOpsLogText(scanned, entry)).toBe(`Skipped ${groundSiteLabel(big.task.poiId)}: needs 2 Security squads, 1 deployed`);
      return;
    }
    throw new Error("no 2-Security clearing task in the sweep");
  });

  it("a Strike + Survey run at Tier IV finishes its clearing tasks and pays them", { timeout: 120_000 }, () => {
    for (let k = 0; k < 20; k++) {
      const done = advanceExpedition(dispatch(crewed(seedAt(k), "ss"), TIER4E).exp, T0 + 2_000_000);
      const finished = clearingTasks(done).filter(({ task }) => task.done);
      if (finished.length === 0) continue;
      for (const { task } of finished) expect(done.findings.some((f) => f.id.includes(`task-${task.id}-`))).toBe(true);
      return;
    }
    throw new Error("no clearing task finished in the sweep");
  });
});
