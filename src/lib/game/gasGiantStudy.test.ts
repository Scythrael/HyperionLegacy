// Gas Giant Study GG-2 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-2): orbital bodies lose their
// ground objectives. D22 / OC-G2: the ship studies a gas giant, nobody lands there. User call 4 (2026-10-19): no
// supply cache on a gas giant, the draw kept. The GG-2 / GG-3 sweep golden (gasGiantStudyGoldens.test.ts) proves every
// other body and every system without a giant draws exactly as before.

import { describe, expect, it } from "vitest";
import {
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  type AwayMember,
  type Expedition,
  type GameState,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import {
  ENCOUNTER_STEPS,
  advanceExpedition,
  candidateSlotSeed,
  expeditionCandidates,
  expeditionLaunchView,
  expeditionRiskPreview,
  makeExpeditionSeed,
  scanStepRoll,
  systemTaskPreview,
} from "./expedition";
import { TIER_I_REGION, isHostileSiteId } from "./riskFactors";
import { FIELD_REPAIR_PLANET_TYPES, fieldRepairSite } from "./groundOps";
import { PLANET_TYPES } from "./expeditionContent";
import { GIANT_CLASSES, type GiantClassId } from "./gasGiantContent";
import {
  GIANT_CLASS_HEAT,
  GIANT_MASS_STEPS,
  GIANT_ZONE_LEAN,
  giantClassWeight,
  giantMassAt,
  isOrbitalPlanetType,
  isStudyBody,
  rollGiantProfile,
  studyStampFor,
  systemZone,
} from "./gasGiantStudy";
import { dispatchPastPropulsion, plainAwayMember, withoutStudy } from "./awayTeamTestFixtures";
import { fixRoundAnswersOffForThisFile } from "./fixRoundAnswersSwitch.fixture";

// Fix round answers Q3 (2026-11-17, "Yes, same every visit": a catalog-named system's bodies are drawn from its
// catalog id, the same every visit) moves this file's pins (the catalog-named systems its runs fly have other bodies).
// They predate it and are about another slice, so the file runs with it off (fixRoundAnswersSwitch.fixture.ts). Q3's
// own pins: expeditionFixRoundE.test.ts.
fixRoundAnswersOffForThisFile("catalogBodies");

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members, the telescope at Level 8 (gasGiantStudyGoldens.test.ts crewed).
function crewed(expeditionSeed?: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: 100_000,
    nextExpeditionId: 2,
    ...(expeditionSeed !== undefined ? { expeditionSeed } : {}),
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const SAVE_SEEDS = Array.from({ length: 64 }, (_, i) => makeExpeditionSeed(0x6a5e1d, i));

// Every candidate system of every tier for 64 save seeds: [seed, region].
function sweepSystems(): { seed: number; region: { tier: RegionTier; enemyTerritory: boolean } }[] {
  const out: { seed: number; region: { tier: RegionTier; enemyTerritory: boolean } }[] = [];
  for (const save of SAVE_SEEDS) for (const tier of TIERS) for (let slot = 0; slot < 3; slot++) out.push({ seed: candidateSlotSeed(save, tier, slot), region: { tier, enemyTerritory: tier >= 3 && slot === 2 } });
  return out;
}

// The dispatched run scanned to the end (every body scanned), from `state` to candidate `id`.
function scannedRun(state: GameState, id: string): Expedition {
  const res = dispatchPastPropulsion(state, "ship-1", 1, id);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  let run = res.expedition;
  for (let t = run.phaseAnchorSeconds + 3600; t < run.phaseAnchorSeconds + 3_000_000 && !run.bodies.every((b) => b.scanned); t += 3600) run = advanceExpedition(run, t);
  expect(run.bodies.every((b) => b.scanned)).toBe(true);
  return run;
}

describe("GG-2 orbital bodies", () => {
  it("the gas giant is the one orbital-only type, and no field repair site can be one", () => {
    expect(PLANET_TYPES.filter((p) => isOrbitalPlanetType(p.id)).map((p) => p.id)).toEqual(["gasGiant"]);
    for (const t of FIELD_REPAIR_PLANET_TYPES) expect(isOrbitalPlanetType(t), t).toBe(false);
    // A system of gas giants only repairs in orbit.
    const bodies = [0, 1, 2].map((i) => ({ id: `b${i}`, planetType: "gasGiant" as const, scanTotal: 100, scanProgress: 0, hazard: 0.1, scanned: false, discoveries: [], activities: [] }));
    expect(fieldRepairSite({ bodies })).toBeNull();
  });

  it("the stamp: only a system with an orbital body, and only an orbital body of a stamped run is a study body", () => {
    expect(studyStampFor([{ planetType: "arid" }, { planetType: "gasGiant" }])).toBe(1);
    expect(studyStampFor([{ planetType: "arid" }, { planetType: "frozen" }])).toBeUndefined();
    expect(isStudyBody({ study: 1 }, { planetType: "gasGiant" })).toBe(true);
    expect(isStudyBody({ study: 1 }, { planetType: "arid" })).toBe(false);
    expect(isStudyBody({}, { planetType: "gasGiant" })).toBe(false);
  });

  it("no hostile site, clearing objective, previewed objective or squad need on any orbital body (64 saves, Tiers I to VII)", () => {
    const scanParams = scannedRun(crewed(), "cand-1-0").scanParams;
    let giants = 0;
    for (const { seed, region } of sweepSystems()) {
      const risk = expeditionRiskPreview(seed, region);
      const preview = systemTaskPreview(seed, scanParams, region);
      const orbital = new Set<number>();
      // The task preview's body grades are the risk preview's (one draw).
      expect(preview.bodies).toEqual(risk.bodies);
      // The planet types come from the risk preview's own generation (the same seed and tier).
      for (const t of preview.tasks) expect(preview.studies ?? []).not.toContain(t.bodyIndex);
      for (const i of preview.studies ?? []) {
        orbital.add(i);
        giants += 1;
        expect(risk.bodies[i].site, `${seed} ${i}`).toBeUndefined();
        expect(risk.bodies[i].clearing, `${seed} ${i}`).toBeUndefined();
      }
      expect(preview.tasks.filter((t) => orbital.has(t.bodyIndex))).toEqual([]);
    }
    expect(giants).toBeGreaterThan(100);
  });

  it("a dispatched study run: the stamp, a giant profile on each orbital body, no ground objective there once scanned", () => {
    let runs = 0;
    for (const save of SAVE_SEEDS.slice(0, 16)) {
      const state = crewed(save);
      for (const c of expeditionCandidates(state, "ship-1")) {
        const run = scannedRun(state, c.id);
        const orbital = run.bodies.map((b) => isOrbitalPlanetType(b.planetType));
        if (!orbital.some(Boolean)) {
          expect("study" in run).toBe(false);
          expect(run.bodies.some((b) => b.giant !== undefined)).toBe(false);
          continue;
        }
        runs += 1;
        expect(run.study).toBe(1);
        run.bodies.forEach((b, i) => {
          if (!orbital[i]) return expect(b.giant).toBeUndefined();
          expect(b.giant).toEqual(rollGiantProfile(run.seed, i, run.bodies.length));
          expect(b.discoveries).toEqual([]);
          expect(b.activities).toEqual([]);
        });
        // Preview == run: the objectives the preview lists per body lead the ones the run stamped (hostile sites the
        // preview always lists are left out: the run reveals one only when its squads field it; a sensor ghost the ship
        // reads while scanning appends one more find, which no preview can foresee).
        const preview = systemTaskPreview(run.seed, run.scanParams, c.region);
        expect(preview.studies).toEqual(orbital.flatMap((o, i) => (o ? [i] : [])));
        run.bodies.forEach((b, i) => {
          const previewed = preview.tasks.filter((t) => !t.hostile && t.bodyIndex === i).map((t) => t.poiId);
          const stamped = b.activities.filter((a) => !isHostileSiteId(a.poiId)).map((a) => a.poiId);
          expect(stamped.slice(0, previewed.length), `${c.id} body ${i}`).toEqual(previewed);
          if (orbital[i]) expect(previewed).toEqual([]);
        });
      }
    }
    expect(runs).toBeGreaterThan(3);
  });

  it("supply caches stop at an orbital body of a study run; draw 2 is still taken (the stream is unchanged)", () => {
    let unstampedCaches = 0;
    let boundaries = 0;
    for (const save of SAVE_SEEDS) {
      const state = crewed(save);
      for (const c of expeditionCandidates(state, "ship-1")) {
        const res = dispatchPastPropulsion(state, "ship-1", 1, c.id);
        const exp = res.expedition!;
        if (!exp.study) continue;
        const bare = withoutStudy(exp);
        exp.bodies.forEach((b, i) => {
          for (let step = 1; step < ENCOUNTER_STEPS; step++) {
            const on = scanStepRoll(exp, i, step);
            const off = scanStepRoll(bare, i, step);
            // Draw 1 (the ship event) reads the same either way.
            expect(on.encounter).toBe(off.encounter);
            if (isOrbitalPlanetType(b.planetType)) {
              boundaries += 1;
              expect(on.supplyCache).toBe(false);
              if (off.supplyCache) unstampedCaches += 1;
            } else expect(on).toEqual(off);
          }
        });
      }
    }
    expect(boundaries).toBeGreaterThan(200);
    // Without the stamp the same draws would have found caches there: the gate, not a moved stream, removes them.
    expect(unstampedCaches).toBeGreaterThan(0);
  });

  it("the launch view counts the ship studies and asks no squad for them", () => {
    const state = crewed();
    const cand = expeditionCandidates(state, "ship-1").find((c) => c.id === "cand-1-2")!;
    const view = expeditionLaunchView(state, "ship-1", cand);
    expect(view.demand?.shipStudies).toBe(1);
    expect(view.forecast?.studies).toBe(1);
    const plain = expeditionLaunchView(state, "ship-1", expeditionCandidates(state, "ship-1").find((c) => c.id === "cand-1-0")!);
    expect(plain.demand && "shipStudies" in plain.demand).toBe(false);
    expect(plain.forecast && "studies" in plain.forecast).toBe(false);
  });

  it("a Tier I region default preview without a giant has no studies key", () => {
    const run = scannedRun(crewed(), "cand-1-0");
    expect("studies" in systemTaskPreview(run.seed, run.scanParams, TIER_I_REGION)).toBe(false);
  });
});

describe("GG-2 the giant profile (the class roll and the mass)", () => {
  it("zones read off the body's index: inner third, outer third, a lone body in the middle", () => {
    expect(systemZone(0, 1)).toBe("middle");
    expect([0, 1].map((i) => systemZone(i, 2))).toEqual(["inner", "outer"]);
    expect([0, 1, 2].map((i) => systemZone(i, 3))).toEqual(["inner", "middle", "outer"]);
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => systemZone(i, 7))).toEqual(["inner", "inner", "middle", "middle", "middle", "outer", "outer"]);
  });

  it("the middle zone reads the approved weights as they are; every class has a heat and is rollable in every zone", () => {
    for (const c of GIANT_CLASSES) {
      expect(giantClassWeight(c, "middle")).toBe(c.weight);
      expect(GIANT_CLASS_HEAT[c.id]).toBeDefined();
      for (const zone of ["inner", "middle", "outer"] as const) expect(giantClassWeight(c, zone)).toBeGreaterThan(0);
    }
    expect(GIANT_ZONE_LEAN.inner.hot).toBeGreaterThan(GIANT_ZONE_LEAN.outer.hot);
    expect(GIANT_ZONE_LEAN.outer.cold).toBeGreaterThan(GIANT_ZONE_LEAN.inner.cold);
  });

  it("deterministic, inside the class's mass band, the band's ends at the first and last step", () => {
    for (let seed = 1; seed < 300; seed++) {
      const p = rollGiantProfile(seed * 7919, seed % 3, 3);
      expect(rollGiantProfile(seed * 7919, seed % 3, 3)).toEqual(p);
      const def = GIANT_CLASSES.find((c) => c.id === p.classId)!;
      expect(Number.isInteger(p.massMilliJ)).toBe(true);
      expect(p.massMilliJ).toBeGreaterThanOrEqual(def.massMinMilliJ);
      expect(p.massMilliJ).toBeLessThanOrEqual(def.massMaxMilliJ);
    }
    for (const c of GIANT_CLASSES) {
      expect(giantMassAt(c, 0)).toBe(c.massMinMilliJ);
      expect(giantMassAt(c, GIANT_MASS_STEPS - 1)).toBe(c.massMaxMilliJ);
    }
  });

  it("inner bodies lean hot and outer bodies lean cold (a real hot-Jupiter trend), every class appears", () => {
    const count = (zone: "inner" | "outer"): Record<GiantClassId, number> => {
      const out = Object.fromEntries(GIANT_CLASSES.map((c) => [c.id, 0])) as Record<GiantClassId, number>;
      for (let seed = 1; seed <= 4000; seed++) out[rollGiantProfile(seed * 2654435761, zone === "inner" ? 0 : 2, 3).classId] += 1;
      return out;
    };
    const inner = count("inner");
    const outer = count("outer");
    for (const c of GIANT_CLASSES) {
      expect(inner[c.id], c.id).toBeGreaterThan(0);
      expect(outer[c.id], c.id).toBeGreaterThan(0);
    }
    const hot = (r: Record<GiantClassId, number>) => r.sudarskyIV + r.sudarskyV;
    const cold = (r: Record<GiantClassId, number>) => r.sudarskyI + r.sudarskyII + r.iceGiant;
    expect(hot(inner)).toBeGreaterThan(2 * hot(outer));
    expect(cold(outer)).toBeGreaterThan(cold(inner));
  });
});
