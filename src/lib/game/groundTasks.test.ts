// Ground Operations (GO-4): the ground task model. Fight points from the site's threat, the exact segment
// haul split, the task work time (Science pace, hazard slowdown, the Security Assault Hardsuit line), and
// the shared task reward seed (the legacy resolver's output pinned across the extraction).

import { describe, it, expect } from "vitest";
import { DEFAULT_GAMBIT_PROGRAMS, type EquipmentInstance, type Expedition, type ExpeditionBody, type SnapshotMember } from "./model";
import { POI_CATALOG, planetTypeHazard } from "./expeditionContent";
import { activityDurationSeconds, ACTIVITY_SECONDS as EXPEDITION_ACTIVITY_SECONDS } from "./expedition";
import { resolveExpeditionActivity, rollHaul, taskRelicSeed, taskRewardSeed } from "./gambit";
import { fieldworkSpeedMult } from "./fieldwork";
import { snapshotMember } from "./awayTeam";
import { plainAwayMember } from "./awayTeamTestFixtures";
import {
  ACTIVITY_SECONDS,
  FIGHT_POINTS_BY_POI,
  FIGHT_POINTS_DEFAULT,
  FIGHT_POINTS_HAZARD_STEP,
  FIGHT_POINTS_MAX,
  FIGHT_POINTS_MIN,
  TASK_HAZARD_PENALTY,
  fightPointCount,
  fightPointFractions,
  segmentCount,
  segmentHaul,
  taskFieldworkRun,
  taskFullHaul,
  taskSecurityHazardResist,
  taskTeamHazardResist,
  taskWorkSeconds,
  type GroundTaskTeam,
} from "./groundTasks";

// ===== Fixtures =====

const ZERO_STATS = { hp: 0, power: 0, armor: 0, accuracy: 0, statusChance: 0, fieldwork: 0, relicFind: 0, hazardResist: 0 };

function snap(memberId: string, teamType: "security" | "science", over: Partial<SnapshotMember> = {}): SnapshotMember {
  return {
    memberId,
    teamType,
    spec: teamType === "science" ? "geology" : "offense",
    rank: 1,
    rankFactor: 1,
    traits: [],
    groundStats: { ...ZERO_STATS },
    resists: {},
    implants: [],
    gear: [],
    gambit: teamType === "security" ? DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r })) : [],
    effects: [],
    ...over,
  };
}

function body(planetType: ExpeditionBody["planetType"], hazard: number): ExpeditionBody {
  return { id: "body-1", planetType, scanTotal: 100, scanProgress: 0, hazard, scanned: false, discoveries: [], activities: [] };
}

function exp(over: Partial<Expedition> = {}): Expedition {
  return {
    id: "expedition-1",
    shipId: "ship-1",
    captainId: 1,
    targetSystemId: "keplersReach",
    systemName: "Kepler's Reach",
    sensorArrayId: null,
    scanParams: { scanRateMult: 1, coverageWidth: 1, landmarkOddsBias: 0, undergroundPoiOddsBias: 0 },
    sensorPower: 0,
    phase: "activities",
    phaseAnchorSeconds: 0,
    shakedown: true,
    bodies: [body("terrestrial", 0)],
    anomalyResolved: false,
    anomalyCharted: false,
    anomalyOptIn: true,
    findings: [],
    seed: 12345,
    securityStrength: 0,
    scienceStrength: 0,
    teamKit: 2,
    gambitPrograms: { security: DEFAULT_GAMBIT_PROGRAMS.security.map((r) => ({ ...r })), science: [] } as Expedition["gambitPrograms"],
    scanSpeedBonus: 0,
    relicFindBonus: 0,
    hazardResist: 0,
    ...over,
  };
}

const sciWith = (id: string, fieldwork: number, hazardResist = 0): SnapshotMember =>
  snap(id, "science", { groundStats: { ...ZERO_STATS, fieldwork, hazardResist } });

// One team holding every roster member, the whole Science crew layer (share 1): the legacy run's party.
function wholeTeam(e: Expedition): GroundTaskTeam {
  return {
    securityIds: (e.roster?.security ?? []).map((m) => m.memberId),
    scienceIds: (e.roster?.science ?? []).map((m) => m.memberId),
    scienceShare: 1,
  };
}

// A real Assault Hardsuit worn by `wearer`, with a rolled hazard-resist line (the D26 line under test).
function hardsuit(wearer: string, hazardPoints: number): EquipmentInstance {
  return {
    id: "equip-901",
    slotType: "memberArmor",
    moduleVariant: "assaultHardsuit",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: "assaultHardsuitBp",
    implicitStats: { groundArmor: 4, groundHp: 4 },
    rolledStats: hazardPoints > 0 ? { groundHazardResist: hazardPoints } : {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    durability: 100,
    fittedToShipId: null,
    fittedToMemberId: wearer,
  } as EquipmentInstance;
}

// ===== Fight points =====

describe("fight points from the site's threat (user 9b.2)", () => {
  it("rates every PoI in the catalog, each within [MIN, MAX]", () => {
    for (const poi of POI_CATALOG) {
      const n = (FIGHT_POINTS_BY_POI as Record<string, number>)[poi.id];
      expect(n, poi.id).toBeGreaterThanOrEqual(FIGHT_POINTS_MIN);
      expect(n, poi.id).toBeLessThanOrEqual(FIGHT_POINTS_MAX);
    }
    expect(Object.keys(FIGHT_POINTS_BY_POI).sort()).toEqual(POI_CATALOG.map((p) => p.id).sort());
  });

  it("reads the table on a calm world", () => {
    expect(fightPointCount("mineralOutcrop", 0)).toBe(1);
    expect(fightPointCount("caveNetwork", 0)).toBe(2);
    expect(fightPointCount("ancientRuins", 0.2)).toBe(2);
    expect(fightPointCount("xenoFloraBloom", 0.3)).toBe(2);
    expect(fightPointCount("crashedShip", 0)).toBe(3);
    expect(fightPointCount("geothermalChamber", 0.5)).toBe(3);
    expect(fightPointCount("buriedVault", 0)).toBe(3);
    expect(fightPointCount("derelictOutpost", 0)).toBe(4);
    expect(fightPointCount("subterraneanCivilization", 0.59)).toBe(4);
  });

  it("adds one fight point at hazard >= the step, and clamps to the max", () => {
    expect(FIGHT_POINTS_HAZARD_STEP).toBe(0.6);
    expect(fightPointCount("mineralOutcrop", 0.6)).toBe(2);
    expect(fightPointCount("mineralOutcrop", 0.5999)).toBe(1);
    expect(fightPointCount("crashedShip", 1)).toBe(4);
    expect(fightPointCount("subterraneanCivilization", 0.9)).toBe(FIGHT_POINTS_MAX);
    // Every PoI at every hazard stays a whole number within the clamp.
    for (const poi of POI_CATALOG) {
      for (const h of [0, 0.25, 0.6, 0.75, 1, 5]) {
        const n = fightPointCount(poi.id, h);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(FIGHT_POINTS_MIN);
        expect(n).toBeLessThanOrEqual(FIGHT_POINTS_MAX);
      }
    }
  });

  it("an unrated PoI id reads the default; a NaN hazard adds nothing; prototype keys are not PoIs", () => {
    expect(fightPointCount("someRetiredPoi", 0)).toBe(FIGHT_POINTS_DEFAULT);
    expect(fightPointCount("someRetiredPoi", 0.8)).toBe(FIGHT_POINTS_DEFAULT + 1);
    expect(fightPointCount("caveNetwork", Number.NaN)).toBe(2);
    expect(fightPointCount("toString", 0)).toBe(FIGHT_POINTS_DEFAULT);
  });

  it("fractions are evenly spaced k / (n + 1)", () => {
    expect(fightPointFractions(1)).toEqual([0.5]);
    expect(fightPointFractions(3)).toEqual([0.25, 0.5, 0.75]);
    expect(fightPointFractions(0)).toEqual([]);
    expect(fightPointFractions(-2)).toEqual([]);
    expect(fightPointFractions(2.5)).toEqual([]);
    for (let n = 1; n <= FIGHT_POINTS_MAX; n += 1) {
      const f = fightPointFractions(n);
      expect(f).toHaveLength(n);
      for (let i = 0; i < n; i += 1) {
        expect(f[i]).toBeGreaterThan(i === 0 ? 0 : f[i - 1]);
        expect(f[i]).toBeLessThan(1);
      }
    }
  });
});

// ===== Segments =====

describe("segments and the exact haul split (user 9b.1)", () => {
  it("a task has one more segment than fight points; an unstamped (legacy) task is one segment", () => {
    expect(segmentCount({})).toBe(1);
    expect(segmentCount({ fightPoints: [0.5] })).toBe(2);
    expect(segmentCount({ fightPoints: fightPointFractions(3) })).toBe(4);
  });

  it("segment shares sum EXACTLY to the full haul for odd totals and N = 2..6", () => {
    for (const total of [1, 3, 7, 13, 59, 101]) {
      for (let N = 2; N <= 6; N += 1) {
        const full = { materials: { scrapAlloy: total, titaniumIngot: total + 2 }, credits: total * 3 };
        const sum = { scrapAlloy: 0, titaniumIngot: 0, credits: 0 };
        for (let s = 0; s < N; s += 1) {
          const seg = segmentHaul(full, N, s);
          sum.scrapAlloy += seg.materials.scrapAlloy ?? 0;
          sum.titaniumIngot += seg.materials.titaniumIngot ?? 0;
          sum.credits += seg.credits;
          // Each share is a whole number within 1 of an even split; a zero line is left out.
          for (const [k, v] of Object.entries(seg.materials)) {
            expect(Number.isInteger(v)).toBe(true);
            expect(v).toBeGreaterThan(0);
            expect(Math.abs(v - (full.materials as Record<string, number>)[k] / N)).toBeLessThan(1);
          }
          expect(Number.isInteger(seg.credits)).toBe(true);
          expect(Math.abs(seg.credits - full.credits / N)).toBeLessThan(1);
        }
        expect(sum).toEqual({ scrapAlloy: total, titaniumIngot: total + 2, credits: total * 3 });
      }
    }
  });

  it("a one-segment task's share is the whole haul; an out-of-range segment is empty", () => {
    const full = { materials: { scrapAlloy: 5 }, credits: 52 };
    expect(segmentHaul(full, 1, 0)).toEqual(full);
    expect(segmentHaul(full, 1, 0)).not.toBe(full);
    expect(segmentHaul(full, 4, 4)).toEqual({ materials: {}, credits: 0 });
    expect(segmentHaul(full, 4, -1)).toEqual({ materials: {}, credits: 0 });
    expect(segmentHaul(full, 0, 0)).toEqual({ materials: {}, credits: 0 });
    expect(segmentHaul(full, 2.5, 0)).toEqual({ materials: {}, credits: 0 });
  });

  it("a small material splits with zero shares left out (3 over 4 segments: -, 1, 1, 1)", () => {
    const full = { materials: { scrapAlloy: 3 }, credits: 0 };
    expect([0, 1, 2, 3].map((s) => segmentHaul(full, 4, s).materials)).toEqual([{}, { scrapAlloy: 1 }, { scrapAlloy: 1 }, { scrapAlloy: 1 }]);
  });
});

// ===== Work time =====

describe("task work time (D25 + D26)", () => {
  it("ACTIVITY_SECONDS moved here; expedition.ts re-exports the same value", () => {
    expect(ACTIVITY_SECONDS).toBe(600);
    expect(EXPEDITION_ACTIVITY_SECONDS).toBe(ACTIVITY_SECONDS);
  });

  it("a bare team on a calm world takes ACTIVITY_SECONDS", () => {
    const e = exp({ roster: { security: [snap("member-1", "security")], science: [] } });
    expect(taskWorkSeconds(e, [wholeTeam(e)], body("terrestrial", 0))).toBe(ACTIVITY_SECONDS);
  });

  it("one team holding the whole roster equals the legacy activityDurationSeconds on a calm world", () => {
    const e = exp({
      scienceStrength: 35,
      roster: { security: [snap("member-1", "security")], science: [sciWith("member-2", 0.6), sciWith("member-3", 0.3)] },
      bodies: [body("volcanic", 0)],
    });
    expect(taskWorkSeconds(e, [wholeTeam(e)], e.bodies[0])).toBe(activityDurationSeconds(e, e.bodies[0]));
    expect(taskWorkSeconds(e, [wholeTeam(e)], e.bodies[0])).toBeLessThan(ACTIVITY_SECONDS);
  });

  it("a Science member with fieldwork shortens work; one outside the team does not", () => {
    const e = exp({ roster: { security: [snap("member-1", "security")], science: [sciWith("member-2", 0.8), sciWith("member-3", 0)] } });
    const calm = body("terrestrial", 0);
    const withWorker = taskWorkSeconds(e, [{ securityIds: ["member-1"], scienceIds: ["member-2"], scienceShare: 1 }], calm);
    const withoutWorker = taskWorkSeconds(e, [{ securityIds: ["member-1"], scienceIds: ["member-3"], scienceShare: 1 }], calm);
    expect(withWorker).toBeLessThan(withoutWorker);
    expect(withoutWorker).toBe(ACTIVITY_SECONDS);
    expect(withWorker).toBe(Math.round(ACTIVITY_SECONDS / fieldworkSpeedMult(taskFieldworkRun(e, [{ securityIds: [], scienceIds: ["member-2"], scienceShare: 1 }]), "terrestrial")));
  });

  it("a team with half the Science crew layer works slower than with all of it; two teams sum their shares", () => {
    const e = exp({ scienceStrength: 80, roster: { security: [], science: [sciWith("member-2", 0), sciWith("member-3", 0)] } });
    const calm = body("terrestrial", 0);
    const half = taskWorkSeconds(e, [{ securityIds: [], scienceIds: ["member-2"], scienceShare: 0.5 }], calm);
    const all = taskWorkSeconds(e, [{ securityIds: [], scienceIds: ["member-2"], scienceShare: 1 }], calm);
    const pair = taskWorkSeconds(
      e,
      [
        { securityIds: [], scienceIds: ["member-2"], scienceShare: 0.5 },
        { securityIds: [], scienceIds: ["member-3"], scienceShare: 0.5 },
      ],
      calm,
    );
    expect(half).toBeGreaterThan(all);
    expect(pair).toBe(all); // both members carry no gear fieldwork: only the summed crew layer moves the pace
    expect(taskFieldworkRun(e, [{ securityIds: [], scienceIds: ["member-2"], scienceShare: -3 }]).scienceStrength).toBe(0);
  });

  it("a hazardous world slows work by (1 + hazard * TASK_HAZARD_PENALTY); the museum resist cuts it", () => {
    const e = exp({ roster: { security: [snap("member-1", "security")], science: [] } });
    const t = [wholeTeam(e)];
    expect(TASK_HAZARD_PENALTY).toBe(0.5);
    expect(taskWorkSeconds(e, t, body("toxic", 1))).toBe(900);
    expect(taskWorkSeconds(e, t, body("toxic", 0.8))).toBe(840);
    const museum = exp({ hazardResist: 0.5, roster: e.roster });
    expect(taskWorkSeconds(museum, t, body("toxic", 0.8))).toBe(720); // 0.8 * (1 - 0.5) = 0.4 -> 600 * 1.2
  });

  it("an Assault Hardsuit on a SECURITY member shortens work on a hazardous body and does nothing on a calm one (D26)", () => {
    const wearer = plainAwayMember("member-1", "security", "ship-1");
    const suited = snapshotMember(wearer, [hardsuit("member-1", 30)]);
    const plain = snapshotMember(wearer, [hardsuit("member-1", 0)]);
    expect(suited.groundStats.hazardResist).toBeGreaterThan(0);
    expect(plain.groundStats.hazardResist ?? 0).toBe(0);
    const eSuited = exp({ roster: { security: [suited], science: [] } });
    const ePlain = exp({ roster: { security: [plain], science: [] } });
    const hazardous = body("toxic", 0.9);
    const calm = body("terrestrial", 0);
    expect(taskSecurityHazardResist(eSuited, [wholeTeam(eSuited)])).toBe(suited.groundStats.hazardResist);
    expect(taskWorkSeconds(eSuited, [wholeTeam(eSuited)], hazardous)).toBeLessThan(taskWorkSeconds(ePlain, [wholeTeam(ePlain)], hazardous));
    expect(taskWorkSeconds(eSuited, [wholeTeam(eSuited)], calm)).toBe(taskWorkSeconds(ePlain, [wholeTeam(ePlain)], calm));
    expect(taskWorkSeconds(eSuited, [wholeTeam(eSuited)], calm)).toBe(ACTIVITY_SECONDS);
    // The suit counts only for a Security member of the team set.
    expect(taskWorkSeconds(eSuited, [{ securityIds: [], scienceIds: [], scienceShare: 1 }], hazardous)).toBe(
      taskWorkSeconds(ePlain, [wholeTeam(ePlain)], hazardous),
    );
  });

  it("the team hazard resist is the Science fieldwork resist plus the Security resist", () => {
    const sec = snap("member-1", "security", { groundStats: { ...ZERO_STATS, hazardResist: 0.1 } });
    const e = exp({ roster: { security: [sec], science: [sciWith("member-2", 0, 0.2)] } });
    expect(taskTeamHazardResist(e, [wholeTeam(e)], body("toxic", 1))).toBeCloseTo(0.3, 12);
    // 1 * (1 - 0.3) = 0.7 -> 600 * 1.35 = 810
    expect(taskWorkSeconds(e, [wholeTeam(e)], body("toxic", 1))).toBe(810);
  });

  it("is floored at 1 second (D23: the pace has no cap)", () => {
    const e = exp({ roster: { security: [], science: [sciWith("member-2", 1e9)] } });
    expect(taskWorkSeconds(e, [wholeTeam(e)], body("terrestrial", 0))).toBe(1);
  });

  it("repeat and unknown member ids never count twice or crash", () => {
    const e = exp({ roster: { security: [snap("member-1", "security")], science: [sciWith("member-2", 0.8)] } });
    const once = taskWorkSeconds(e, [{ securityIds: [], scienceIds: ["member-2"], scienceShare: 1 }], body("terrestrial", 0));
    const twice = taskWorkSeconds(
      e,
      [
        { securityIds: ["nobody"], scienceIds: ["member-2", "member-2"], scienceShare: 1 },
        { securityIds: [], scienceIds: ["member-2", "ghost"], scienceShare: 0 },
      ],
      body("terrestrial", 0),
    );
    expect(twice).toBe(once);
  });
});

// ===== The shared task reward seed (legacy pinned) =====

describe("taskRewardSeed: ONE reward seed definition for legacy and Ground Ops", () => {
  it("pins the seed formula (exp.seed ^ REWARD_SALT ^ imul(flatIndex + 1, 0x27d4eb2f)) and the relic sub-stream", () => {
    expect(taskRewardSeed({ seed: 12345 }, 0)).toBe(418605811);
    expect(taskRewardSeed({ seed: 12345 }, 5)).toBe(3520725702);
    expect(taskRewardSeed({ seed: 987654321 }, 7)).toBe(996048940);
    expect(taskRelicSeed({ seed: 12345 }, 0)).toBe(245697858);
  });

  // Captured from resolveExpeditionActivity BEFORE the taskRewardSeed extraction (GO-4): the win haul, the
  // relic roll, the evacuation haul and the D18 no-team path all read the same keyed reward stream, so the
  // extraction must leave every one byte-identical.
  it("legacy resolveExpeditionActivity output is unchanged by the extraction (pinned)", () => {
    const strong = { security: [snap("member-1", "security"), snap("member-2", "security"), snap("member-3", "security")], science: [] };
    const withSci = {
      security: strong.security,
      science: [snap("member-4", "science", { groundStats: { ...ZERO_STATS, fieldwork: 0.4, relicFind: 0.2 } })],
    };
    const act = (poiId: string) => ({ id: "expedition-1-body-1-act-0", bodyId: "body-1", poiId, done: false });
    const fid = "expedition-1-find-act-expedition-1-body-1-act-0";
    const relic = { id: "expedition-1-relic-expedition-1-body-1-act-0", tier: "standard", quality: 0, unidentified: true };
    const a = exp({ securityStrength: 40, teamKit: 6, roster: strong, bodies: [planetBody("terrestrial")] });
    const b = exp({ securityStrength: 40, scienceStrength: 30, teamKit: 6, roster: withSci, seed: 987654321, bodies: [planetBody("terrestrial")] });
    const c = exp({ teamKit: 0, roster: { security: [snap("member-1", "security")], science: [] }, bodies: [planetBody("toxic")] });
    const d = exp({ roster: { security: [], science: [] }, bodies: [planetBody("volcanic")], seed: 4242 });

    expect(resolveExpeditionActivity(a, a.bodies[0], act("caveNetwork"), 0)).toEqual({
      finding: { id: fid, source: "activity", poiId: "caveNetwork", materials: { scrapAlloy: 3 }, credits: 52, relic: null },
      outcome: "win",
      attempts: 1,
      downedMemberIds: [],
    });
    expect(resolveExpeditionActivity(a, a.bodies[0], act("ancientRuins"), 5)).toEqual({
      finding: { id: fid, source: "activity", poiId: "ancientRuins", materials: { scrapAlloy: 2 }, credits: 52, relic },
      outcome: "win",
      attempts: 1,
      downedMemberIds: [],
    });
    expect(resolveExpeditionActivity(b, b.bodies[0], act("crashedShip"), 7, undefined, 30)).toEqual({
      finding: { id: fid, source: "activity", poiId: "crashedShip", materials: { titaniumIngot: 8 }, credits: 68, relic },
      outcome: "win",
      attempts: 1,
      downedMemberIds: [],
    });
    expect(resolveExpeditionActivity(c, c.bodies[0], act("subterraneanCivilization"), 3)).toEqual({
      finding: { id: fid, source: "activity", poiId: "subterraneanCivilization", materials: { anomalousAlloy: 1 }, credits: 59, relic: null, evacuated: true },
      outcome: "evacuated",
      attempts: 1,
      downedMemberIds: ["member-1"],
    });
    expect(resolveExpeditionActivity(d, d.bodies[0], act("mineralOutcrop"), 2)).toEqual({
      finding: { id: fid, source: "activity", poiId: "mineralOutcrop", materials: { anomalousAlloy: 2 }, credits: 47, relic: null, evacuated: true },
      outcome: "evacuated",
      attempts: 0,
      downedMemberIds: [],
    });
  });

  it("taskFullHaul rolls the SAME keyed stream as the legacy win haul (one team holding the whole roster)", () => {
    const strong = { security: [snap("member-1", "security"), snap("member-2", "security"), snap("member-3", "security")], science: [] };
    const withSci = {
      security: strong.security,
      science: [snap("member-4", "science", { groundStats: { ...ZERO_STATS, fieldwork: 0.4, relicFind: 0.2 } })],
    };
    const a = exp({ securityStrength: 40, teamKit: 6, roster: strong, bodies: [planetBody("terrestrial")] });
    const b = exp({ securityStrength: 40, scienceStrength: 30, teamKit: 6, roster: withSci, seed: 987654321, bodies: [planetBody("terrestrial")] });
    expect(taskFullHaul(a, [wholeTeam(a)], a.bodies[0], "caveNetwork", 0)).toEqual({ materials: { scrapAlloy: 3 }, credits: 52 });
    expect(taskFullHaul(b, [wholeTeam(b)], b.bodies[0], "crashedShip", 7)).toEqual({ materials: { titaniumIngot: 8 }, credits: 68 });
    // rollHaul is the one haul roll: yieldMult 1 at the raw hazard reproduces the bare haul.
    expect(rollHaul(taskRewardSeed(a, 0), "terrestrial", a.bodies[0].hazard, 1)).toEqual({ materials: { scrapAlloy: 3 }, credits: 52 });
  });

  it("the full haul splits across a task's segments with nothing lost", () => {
    const e = exp({ roster: { security: [snap("member-1", "security")], science: [sciWith("member-2", 0.5)] }, bodies: [planetBody("toxic")] });
    const full = taskFullHaul(e, [wholeTeam(e)], e.bodies[0], "derelictOutpost", 4);
    const N = segmentCount({ fightPoints: fightPointFractions(fightPointCount("derelictOutpost", e.bodies[0].hazard)) });
    let credits = 0;
    const mats: Record<string, number> = {};
    for (let s = 0; s < N; s += 1) {
      const seg = segmentHaul(full, N, s);
      credits += seg.credits;
      for (const [k, v] of Object.entries(seg.materials)) mats[k] = (mats[k] ?? 0) + v;
    }
    expect({ materials: mats, credits }).toEqual(full);
  });
});

// A body of `planetType` at its catalog hazard (the legacy fixtures' bodies).
function planetBody(planetType: ExpeditionBody["planetType"]): ExpeditionBody {
  return body(planetType, planetTypeHazard(planetType));
}
