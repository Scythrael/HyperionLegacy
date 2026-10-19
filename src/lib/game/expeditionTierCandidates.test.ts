// Expedition Tiers G2-2 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-2): candidates per region
// tier, their names, real stars, Wolf 359, enemy territory, bodies per tier and the tier haul. The Tier I byte
// identity with the pre-G2 runs is expeditionTiersGoldens.test.ts's (goldens 2 and 3 with the names restored).

import { describe, expect, it } from "vitest";
import {
  freshState,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  type AwayMember,
  type Expedition,
  type GameState,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import {
  CANDIDATE_STRIDE,
  EXPEDITION_CANDIDATE_COUNT,
  FAMOUS_SYSTEM_ONE_IN,
  TIER_BODY_COUNT,
  WOLF_359_LIST_AFTER_DISPATCHES,
  advanceExpedition,
  advanceExpeditionSeed,
  candidateSlotSeed,
  candidateSystemById,
  expeditionCandidates,
  expeditionLaunchView,
  expeditionRiskPreview,
  makeExpeditionSeed,
  startExpedition,
  systemTaskPreview,
  tierCandidateSystems,
} from "./expedition";
import { ENEMY_SECTOR_WIDTH_PERMILLE, REGION_TIERS, homeworldPlacement, inEnemySector, stateHomeworld } from "./galaxy";
import { FAMOUS_SYSTEMS, REGION_CODES, WOLF_359_ID, famousSystem, famousSystemFrom } from "./starCatalog";
import { TIER_HAUL_MULT, TIER_I_REGION } from "./riskFactors";
import { taskFullHaul } from "./groundTasks";
import { plainAwayMember } from "./awayTeamTestFixtures";
import { bodyDesignation, bodyTitle } from "../groundTaskQueueDisplay";
import { nearestFirst, runRegionText } from "../expeditionDispatchDisplay";
import { taskNeedsOf } from "./groundOps";

const T0 = 100_000;
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];

// ship-1 with two Ground teams of six rank 10 members, the clock at T0, the telescope at Level 8 (reads every tier),
// a homeworld from `home` and the expedition seed `seed`.
function crewed(seed: number, home = 0x6a09e667, nextExpeditionId = 3): GameState {
  const base = freshState(home);
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return {
    ...base,
    gameTimeSeconds: T0,
    expeditionSeed: seed >>> 0,
    nextExpeditionId,
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
}

const seedOf = (k: number): number => Math.imul(k + 1, 0x2545f491) >>> 0;

describe("G2-2 candidates per region tier", () => {
  it("three per tier, ids cand-<tier>-<slot>, seeds on the stride (Tier I's are the pre-G2 three), nearest first, in the band", () => {
    for (let k = 0; k < 16; k++) {
      const state = crewed(seedOf(k), seedOf(k + 100));
      const home = stateHomeworld(state);
      for (const tier of REGION_TIERS) {
        const cands = expeditionCandidates(state, "ship-1", tier);
        expect(cands.length).toBe(EXPEDITION_CANDIDATE_COUNT);
        expect(cands.map((c) => c.index).sort()).toEqual([0, 1, 2]);
        const band = home.regionBandsLy[tier];
        for (const c of cands) {
          expect(c.id).toBe(`cand-${tier}-${c.index}`);
          expect(c.seed).toBe(makeExpeditionSeed(state.expeditionSeed, (tier - 1) * CANDIDATE_STRIDE + c.index));
          expect(c.seed).toBe(candidateSlotSeed(state.expeditionSeed, tier, c.index));
          expect(c.region.tier).toBe(tier);
          expect(c.telescope.regionTier).toBe(tier);
          expect(c.telescope.distanceLy).toBeGreaterThan(band.near);
          expect(c.telescope.distanceLy).toBeLessThanOrEqual(band.far);
          expect(Number.isInteger(c.telescope.distanceLy)).toBe(true);
        }
        // The engine keeps slot order; the console shows them nearest first (nearestFirst).
        expect(cands.map((c) => c.index)).toEqual([0, 1, 2]);
        const d = nearestFirst(cands).map((c) => c.telescope.distanceLy);
        expect(d).toEqual([...d].sort((a, b) => a - b));
      }
      // Tier I's slot i is the pre-G2 candidate i.
      for (let i = 0; i < EXPEDITION_CANDIDATE_COUNT; i++) {
        expect(tierCandidateSystems(state, 1).find((c) => c.slot === i)!.seed).toBe(makeExpeditionSeed(state.expeditionSeed, i));
      }
    }
  });

  it("stable across ticks; the lists of every tier advance only on a dispatch", () => {
    const state = crewed(seedOf(3));
    const lists = (s: GameState) => REGION_TIERS.map((t) => expeditionCandidates(s, "ship-1", t));
    const before = lists(state);
    expect(lists({ ...state, gameTimeSeconds: state.gameTimeSeconds + 86_400 })).toEqual(before);
    expect(lists(state)).toEqual(before);
    const res = startExpedition(state, "ship-1", 1, "cand-5-1");
    expect(res.success).toBe(true);
    expect(res.next.expeditionSeed).toBe(advanceExpeditionSeed(state.expeditionSeed));
    const after = lists({ ...res.next, expeditions: [] });
    for (let t = 0; t < 7; t++) expect(after[t].map((c) => c.seed)).not.toEqual(before[t].map((c) => c.seed));
  });

  it("a pre-G2 id cand-<slot> names the Tier I slot; unknown ids are refused", () => {
    const state = crewed(seedOf(5));
    for (let i = 0; i < 3; i++) expect(candidateSystemById(state, `cand-${i}`)).toEqual(candidateSystemById(state, `cand-1-${i}`));
    for (const bad of ["cand-3", "cand-8-0", "cand-0-0", "cand-1-3", "cand-x", "cand--1", "cand-01", "cand-1-01"]) expect(candidateSystemById(state, bad)).toBeNull();
    expect(startExpedition(state, "ship-1", 1, "cand-1-3").reason).toBe("noSuchCandidate");
    const a = startExpedition(state, "ship-1", 1, "cand-0").expedition!;
    const b = startExpedition(state, "ship-1", 1, "cand-1-0").expedition!;
    expect(a).toEqual(b);
  });

  it("preview == run at every tier I to VII on 16 seeds: the region, the name, the distance, the risk and every body", () => {
    for (const tier of REGION_TIERS) {
      for (let k = 0; k < 16; k++) {
        const state = crewed(seedOf(k * 7 + tier), seedOf(k + 40));
        const cand = expeditionCandidates(state, "ship-1", tier)[k % 3];
        const exp = startExpedition(state, "ship-1", 1, cand.id).expedition!;
        const preview = expeditionRiskPreview(cand.seed, cand.region);
        expect(exp.seed).toBe(cand.seed);
        expect(exp.systemName).toBe(cand.systemName);
        expect(exp.targetSystemId).toBe(cand.systemId);
        expect(exp.risk).toEqual(preview.profile);
        expect(exp.risk!.tier).toBe(tier);
        expect(exp.risk!.enemyTerritory).toBe(cand.region.enemyTerritory);
        expect(exp.bodies.map((b) => b.risk)).toEqual(preview.bodies);
        expect(exp.region).toEqual({
          version: 1,
          tier,
          enemyTerritory: cand.region.enemyTerritory,
          bearing: tierCandidateSystems(state, tier).find((c) => c.id === cand.id)!.bearing,
          distanceLy: cand.telescope.distanceLy,
        });
        const [min, max] = TIER_BODY_COUNT[tier];
        expect(exp.bodies.length).toBeGreaterThanOrEqual(min);
        expect(exp.bodies.length).toBeLessThanOrEqual(max);
        // At Forecast detail the telescope's per-body reading is exactly the run's.
        expect(cand.telescope.risk!.bodies!.length).toBe(exp.bodies.length);
      }
    }
  });

  it("preview == run on the objectives at every tier (4 seeds each): needs, difficulty, fight points; hostile sites a subset", () => {
    for (const tier of REGION_TIERS) {
      for (let k = 0; k < 4; k++) {
        const state = crewed(seedOf(k * 11 + tier * 3), seedOf(k + 70));
        const cand = expeditionCandidates(state, "ship-1", tier)[0];
        const exp = startExpedition(state, "ship-1", 1, cand.id).expedition!;
        const preview = systemTaskPreview(cand.seed, exp.scanParams, cand.region);
        expect(preview.tier).toBe(tier);
        let e: Expedition = exp;
        for (let t = T0 + 3_600; e.bodies.some((b) => !b.scanned) && t < T0 + 3_000_000; t += 3_600) e = advanceExpedition(e, t);
        expect(e.bodies.every((b) => b.scanned)).toBe(true);
        const key = (x: { bodyIndex: number; poiId: string; needs: unknown; difficulty: number; fightPoints: number }) => JSON.stringify([x.bodyIndex, x.poiId, x.needs, x.difficulty, x.fightPoints]);
        // Every previewed objective the deployment fields is stamped on the run as previewed (a ship scan event can
        // add a bonus discovery on top, so the run's list may hold more). Hostile sites join only where fielded.
        const ran = e.bodies.flatMap((b, bodyIndex) =>
          b.activities.map((a) => key({ bodyIndex, poiId: a.poiId, needs: taskNeedsOf(a), difficulty: a.difficulty ?? 1, fightPoints: a.fightPoints?.length ?? 0 })),
        );
        const left = [...ran];
        for (const p of preview.tasks.filter((x) => !x.hostile)) {
          const at = left.indexOf(key(p));
          expect(at, `Tier ${tier} seed ${k}: ${key(p)}`).toBeGreaterThanOrEqual(0);
          left.splice(at, 1);
        }
        const hostileRan = e.bodies.flatMap((b, bodyIndex) => b.activities.filter((a) => preview.tasks.some((p) => p.hostile && p.poiId === a.poiId)).map((a) => ({ bodyIndex, poiId: a.poiId })));
        for (const h of hostileRan) expect(preview.tasks.some((p) => p.hostile && p.poiId === h.poiId && p.bodyIndex === h.bodyIndex)).toBe(true);
      }
    }
  });

  it("the launch view reads the candidate's region (a deeper tier's preview, not Tier I's)", () => {
    const state = crewed(seedOf(9));
    const cand = expeditionCandidates(state, "ship-1", 5)[0];
    const view = expeditionLaunchView(state, "ship-1", cand);
    expect(view.demand).not.toBeNull();
    const asTierI = expeditionLaunchView(state, "ship-1", { seed: cand.seed, telescope: cand.telescope });
    expect(asTierI).toEqual(expeditionLaunchView(state, "ship-1", { ...cand, region: TIER_I_REGION }));
  });
});

describe("G2-2 enemy territory: the homeworld's fixed sectors (user G8)", () => {
  it("a candidate is enemy territory exactly when its bearing lies in its tier's sector; Tier I never", () => {
    const hits: Record<number, number> = {};
    const total: Record<number, number> = {};
    for (let k = 0; k < 400; k++) {
      const state = crewed(seedOf(k), seedOf(k + 5_000));
      const home = stateHomeworld(state);
      for (const tier of REGION_TIERS) {
        for (const c of tierCandidateSystems(state, tier)) {
          expect(c.region.enemyTerritory).toBe(inEnemySector(home, tier, c.bearing));
          if (tier === 1) expect(c.region.enemyTerritory).toBe(false);
          hits[tier] = (hits[tier] ?? 0) + (c.region.enemyTerritory ? 1 : 0);
          total[tier] = (total[tier] ?? 0) + 1;
        }
      }
    }
    // The frequency per tier tracks the sector widths (1,200 candidates per tier; 4 standard errors at most).
    for (const tier of REGION_TIERS) {
      const p = ENEMY_SECTOR_WIDTH_PERMILLE[tier] / 1000;
      const tol = 4 * Math.sqrt(Math.max(p * (1 - p), 0.0001) / total[tier]) + 0.005;
      expect(Math.abs(hits[tier] / total[tier] - p), `Tier ${tier}`).toBeLessThanOrEqual(tol);
    }
  });

  it("the risk reads it: an enemy territory candidate's combat grade is one step up (ENEMY_TERRITORY_COMBAT_STEP)", () => {
    let seen = 0;
    for (let k = 0; k < 60 && seen < 5; k++) {
      const state = crewed(seedOf(k), seedOf(k + 9_000));
      for (const c of expeditionCandidates(state, "ship-1", 7)) {
        if (!c.region.enemyTerritory) continue;
        seen += 1;
        const open = expeditionRiskPreview(c.seed, { tier: 7, enemyTerritory: false }).profile.system.combat;
        expect(expeditionRiskPreview(c.seed, c.region).profile.system.combat).toBe(Math.min(4, open + 1));
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("a save with no stored homeworld (the provisional spot) has no enemy territory", () => {
    const state = { ...crewed(seedOf(1)), homeworld: undefined };
    for (const tier of REGION_TIERS) for (const c of tierCandidateSystems(state, tier)) expect(c.region.enemyTerritory).toBe(false);
  });
});

describe("G2-2 names, real stars and Wolf 359", () => {
  it("catalog names carry the tier's code; famous systems come from their own tier, never twice in one list, about 1 in 12", () => {
    let famous = 0;
    let slots = 0;
    for (let k = 0; k < 300; k++) {
      const state = crewed(seedOf(k), seedOf(k + 300), 5);
      for (const tier of REGION_TIERS) {
        const list = tierCandidateSystems(state, tier);
        const ids = list.filter((c) => c.famousId !== null).map((c) => c.famousId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const c of list) {
          slots += 1;
          if (c.famousId === null) expect(c.systemName).toMatch(new RegExp(`^${REGION_CODES[tier]}-\\d{4}$`));
          else {
            famous += 1;
            expect(famousSystem(c.famousId)!.tier).toBe(tier);
            expect(c.systemName).toBe(famousSystem(c.famousId)!.name);
          }
        }
      }
    }
    const rate = famous / slots;
    expect(Math.abs(rate - 1 / FAMOUS_SYSTEM_ONE_IN)).toBeLessThan(0.02);
  });

  it("a famous system reads its real distance and bearing from the homeworld (inside its band)", () => {
    let seen = 0;
    for (let k = 0; k < 200; k++) {
      const state = crewed(seedOf(k), seedOf(k + 777), 4);
      const home = stateHomeworld(state);
      for (const tier of REGION_TIERS) {
        for (const c of tierCandidateSystems(state, tier).filter((x) => x.famousId !== null)) {
          seen += 1;
          const band = home.regionBandsLy[tier];
          expect(c.distanceLy).toBeGreaterThan(band.near);
          expect(c.distanceLy).toBeLessThanOrEqual(band.far);
        }
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it(`Wolf 359 is in the Tier I list after ${WOLF_359_LIST_AFTER_DISPATCHES} dispatch, every save, every homeworld (user G10)`, () => {
    for (let k = 0; k < 100; k++) {
      const state = crewed(seedOf(k), seedOf(k + 31), WOLF_359_LIST_AFTER_DISPATCHES + 1);
      const list = expeditionCandidates(state, "ship-1", 1);
      const wolf = list.find((c) => c.systemId === WOLF_359_ID)!;
      expect(wolf).toBeDefined();
      expect(wolf.index).toBe(0);
      expect(wolf.systemName).toBe("Wolf 359");
      expect(list.filter((c) => c.systemId === WOLF_359_ID).length).toBe(1);
      // Never forced into a deeper tier.
      for (const tier of REGION_TIERS.slice(1)) expect(tierCandidateSystems(state, tier).some((c) => c.famousId === WOLF_359_ID)).toBe(false);
      const exp = startExpedition(state, "ship-1", 1, wolf.id).expedition!;
      expect(exp.systemName).toBe("Wolf 359");
      expect(exp.risk!.tier).toBe(1);
    }
    // The first list (no dispatch yet) and the later ones are not forced: Wolf 359 is not always slot 0 there.
    for (const n of [1, WOLF_359_LIST_AFTER_DISPATCHES + 2]) {
      const forced = Array.from({ length: 40 }, (_, k) => tierCandidateSystems(crewed(seedOf(k), seedOf(k), n), 1).some((c) => c.famousId === WOLF_359_ID));
      expect(forced.every(Boolean)).toBe(false);
    }
  });

  it("every famous system lands in its own tier from 1,000 homeworlds (the clamp never moves a deeper one)", () => {
    for (let i = 0; i < 1_000; i++) {
      const home = homeworldPlacement(Math.imul(i + 7, 0x9e3779b1) >>> 0);
      for (const f of FAMOUS_SYSTEMS.filter((x) => x.tier > 1)) {
        const band = home.regionBandsLy[f.tier];
        const d = famousSystemFrom(f, home).distanceLy;
        expect(d > band.near && d <= band.far, `${f.name} from ${home.id}`).toBe(true);
      }
    }
  });
});

describe("G2-2 bodies per tier and the tier haul", () => {
  it("each tier's body count stays in its range and covers it (user G17); Tier I keeps 1 to 3", () => {
    for (const tier of REGION_TIERS) {
      const counts = new Set<number>();
      for (let k = 0; k < 200; k++) counts.add(expeditionRiskPreview(makeExpeditionSeed(seedOf(k), tier), { tier, enemyTerritory: false }).bodies.length);
      const [min, max] = TIER_BODY_COUNT[tier];
      expect([...counts].sort()).toEqual(Array.from({ length: max - min + 1 }, (_, i) => min + i));
    }
    expect(TIER_BODY_COUNT[1]).toEqual([1, 3]);
  });

  it("a deeper tier's haul is the Tier I haul times the tier's multiplier, on the same draws (user G16)", () => {
    const exp = startExpedition(crewed(seedOf(2)), "ship-1", 1, "cand-1-0").expedition!;
    const body = { planetType: "terrestrial" as const, hazard: 0.2 };
    const t = exp.groundOps!.teams[0];
    const teams = [{ securityIds: t.securityIds, scienceIds: t.scienceIds, scienceShare: 1 }];
    let grew = 0;
    for (const tier of REGION_TIERS) {
      const tiered = taskFullHaul({ ...exp, region: { ...exp.region!, tier: tier as RegionTier } }, teams, body, "derelictOutpost", 0);
      const asBonus = taskFullHaul({ ...exp, region: { ...exp.region!, tier: 1 } }, teams, body, "derelictOutpost", 0, TIER_HAUL_MULT[tier] - 1);
      expect(tiered, `Tier ${tier}`).toEqual(asBonus);
      if (tier > 1 && tiered.credits > taskFullHaul(exp, teams, body, "derelictOutpost", 0).credits) grew += 1;
    }
    expect(grew).toBe(6);
    // Tier I (x1) and a run without the stamp (dispatched before G2-2) roll the same haul.
    expect(taskFullHaul({ ...exp, region: undefined }, teams, body, "derelictOutpost", 0)).toEqual(taskFullHaul(exp, teams, body, "derelictOutpost", 0));
  });

  it("on a real run: a Tier III stamp brings home more than the same run stamped Tier I, on the same timeline", () => {
    const exp = startExpedition(crewed(seedOf(12)), "ship-1", 1, "cand-3-0").expedition!;
    const FINAL = T0 + 2_000_000;
    const deep = advanceExpedition(exp, FINAL);
    const near = advanceExpedition({ ...exp, region: { ...exp.region!, tier: 1 } }, FINAL);
    const credits = (e: Expedition) => e.findings.reduce((s, f) => s + (f.credits ?? 0), 0);
    expect(deep.phase).toBe(near.phase);
    expect(deep.findings.length).toBe(near.findings.length);
    expect(credits(near)).toBeGreaterThan(0);
    expect(credits(deep)).toBeGreaterThan(credits(near));
  });
});

describe("G2-2 offline == live on deeper-tier runs", () => {
  for (const id of ["cand-3-1", "cand-7-2"]) {
    it(`${id}: one call == 997 s chunks (the region stamp, the bodies and the tier haul)`, { timeout: 60_000 }, () => {
      const exp = startExpedition(crewed(seedOf(21)), "ship-1", 1, id).expedition!;
      const end = T0 + 2_000_000;
      const one = advanceExpedition(exp, end);
      let e = exp;
      for (let t = T0 + 997; t < end; t += 997) e = advanceExpedition(e, t);
      expect(advanceExpedition(e, end)).toEqual(one);
      expect(one.region).toEqual(exp.region);
    });
  }
});

describe("G2-2 display", () => {
  it("a stamped run letters its bodies b, c, d; a pre-G2 run keeps Roman numerals; the header names its region", () => {
    const exp = startExpedition(crewed(seedOf(4)), "ship-1", 1, "cand-1-0").expedition!;
    expect(exp.region).toBeDefined();
    expect([0, 1, 2].map((i) => bodyDesignation(exp, i))).toEqual(["b", "c", "d"]);
    expect(bodyTitle(exp, { planetType: "terrestrial" }, 1)).toBe(`${exp.systemName} c · Terrestrial`);
    const legacy = { ...exp, region: undefined };
    expect([0, 1, 2].map((i) => bodyDesignation(legacy, i))).toEqual(["I", "II", "III"]);
    expect(runRegionText(exp)).toBe(`Tier I · Local Bubble · ${exp.region!.distanceLy} ly from your homeworld`);
    expect(runRegionText(legacy)).toBeNull();
  });
});
