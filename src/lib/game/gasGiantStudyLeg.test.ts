// Gas Giant Study GG-3 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-3): the study leg and its
// reward. User call 3 "The ship, always": no squad needed; call 6 "Reuse lines": the Galileo's fieldwork is the study
// speed, its hazard resist the crush rating (the dive), its relic find the ancient data odds; call 12: 30 minutes base;
// 1b.3: canisters always, research data 40%, a Survey Log readout 15%. The v3 mockup's timeline (signed off as drawn):
// the scan clock pauses while the ship holds orbit, the teams keep working, a pickup waits for the ship.

import { describe, expect, it } from "vitest";
import Decimal from "break_infinity.js";
import {
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  type AwayMember,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type RegionTier,
  type ShipGroundTeam,
} from "./model";
import { advanceExpedition, claimExpedition, depositExpeditionFindings, expeditionCandidates, makeExpeditionSeed } from "./expedition";
import { RETURN_SECONDS, groundOpsProgress, groundShipPosition, scanClockAt, studyPickupAt } from "./groundOps";
import { itemTotal } from "./inventory";
import {
  ANCIENT_DATA_FRAGMENT_ID,
  GAS_CANISTER_IDS,
  GIANT_CLASSES,
  ITEM_BANDS,
  RESEARCH_DATA_ITEM,
  RESEARCH_FAMILIES,
  type GiantClassId,
} from "./gasGiantContent";
import {
  ANCIENT_FRAGMENT_BASE_PERMILLE,
  GALILEO_REFERENCE_LINES,
  STUDY_BASE_SECONDS,
  STUDY_CANISTERS_MIN,
  STUDY_MIN_SECONDS,
  STUDY_RESEARCH_DATA_PERMILLE,
  STUDY_SURVEY_READOUT_PERMILLE,
  ancientFragmentPermille,
  giantDepthFactor,
  isOrbitalPlanetType,
  rollStudyReward,
  studyCanisterRange,
  studyCanisterScale,
  studyDiveBonus,
  studyDiveEvents,
  studyProbe,
  studySeconds,
} from "./gasGiantStudy";
import { ITEMS } from "./model";
import { asPreNebulaDispatch, dispatchPastPropulsion, plainAwayMember, withoutStudy } from "./awayTeamTestFixtures";

// Fix round FR-E (0.14.0): this file runs with the round on. Its "giant before the last body" system is found, not fixed
// (BEFORE_LAST): the old capture (save seed 0x51f15e, Tier I candidate 0) is Wolf 359 on the first list after the first
// run, whose bodies the star rule (lane 3 I2) now draws from the star, and the star has no giant.

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const T0 = 100_000;

// ship-1 with two Ground teams of six rank 10 members, the telescope at Level 8; `galileo` puts a Galileo-Class Probe
// of `points` (at the variety's ratios) on the first Science member.
function crewed(expeditionSeed?: number, galileo = false, points = 20): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  const s: GameState = {
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    ...(expeditionSeed !== undefined ? { expeditionSeed } : {}),
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
  return galileo ? withGalileo(s, SCI[0], points) : s;
}

function withGalileo(s: GameState, memberId: string, points: number, id = `galileo-${memberId}`): GameState {
  const piece = {
    id,
    slotType: "memberTool",
    moduleVariant: "atmoProbe",
    rarity: "standard",
    ascension: "none",
    quality: 0,
    iLevel: 10,
    blueprintKey: null,
    implicitStats: { groundFieldwork: points * 0.6, groundHazardResist: points * 0.3, groundRelicFind: points * 0.1 },
    rolledStats: {},
    mass: 0,
    powerDraw: 0,
    durabilityMax: 100,
    fittedToShipId: null,
    fittedToMemberId: memberId,
  } as unknown as EquipmentInstance;
  return { ...s, equipment: [...s.equipment.filter((e) => e.id !== id), piece] };
}

function dispatch(state: GameState, id: string): { next: GameState; exp: Expedition } {
  // GG-4 (merged after GG-3): the giant's study alone, so the nebula stamp comes off (a run before GG-4; the sweep is
  // gasGiantNebula.test.ts's).
  const res = asPreNebulaDispatch(dispatchPastPropulsion(state, "ship-1", 1, id));
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return { next: res.next, exp: res.expedition };
}

// Advance in 600 s steps until every body is scanned and every study is done (or the horizon).
function settled(exp: Expedition): Expedition {
  let run = exp;
  const done = (r: Expedition) => r.bodies.every((b) => b.scanned) && (r.groundOps?.studyLegs ?? []).every((l) => l.done);
  for (let t = exp.phaseAnchorSeconds + 600; t < exp.phaseAnchorSeconds + 4_000_000 && !done(run); t += 600) run = advanceExpedition(run, t);
  expect(done(run)).toBe(true);
  return run;
}

// The GG-0 gas giant system: a fresh save's candidate 2 (body 1 is the giant) while a catalog-named system's bodies
// came from its list slot. Fix round answers Q3 fix pass: drawn from its name, that system has no giant, so the system
// is found: the first save from the fresh one (save seeds from 0x51f15e) whose list holds a study run with a giant,
// candidate 2 first. With Q3 off it is the fresh save's candidate 2, as before. `nextExpeditionId` 1 finds a training
// run's (a fresh save's first expedition).
function giantSystem(nextExpeditionId = 2): { save: number | undefined; id: string } {
  for (let k = -1; k < 200; k++) {
    const save = k < 0 ? undefined : (0x51f15e + k * 977) >>> 0;
    for (const id of ["cand-1-2", "cand-1-0", "cand-1-1"]) {
      const res = asPreNebulaDispatch(dispatchPastPropulsion({ ...crewed(save), nextExpeditionId }, "ship-1", 1, id));
      if (res.success && res.expedition?.study && res.expedition.bodies.some((b) => isOrbitalPlanetType(b.planetType))) return { save, id };
    }
  }
  throw new Error("no study run with a gas giant");
}
const { save: SAVE, id: GIANT } = giantSystem();
const TRAINING = giantSystem(1);

// A Tier I study run whose giant is not the last body: the first such candidate from save seed 0x51f15e on. Pure.
const BEFORE_LAST = ((): { save: number; id: string } => {
  for (let k = 0; k < 200; k++) {
    const save = (0x51f15e + k * 977) >>> 0;
    for (const id of ["cand-1-0", "cand-1-1", "cand-1-2"]) {
      const res = asPreNebulaDispatch(dispatchPastPropulsion(crewed(save), "ship-1", 1, id));
      const exp = res.expedition;
      if (!res.success || !exp?.study) continue;
      const giant = exp.bodies.findIndex((b) => isOrbitalPlanetType(b.planetType));
      if (giant >= 0 && giant < exp.bodies.length - 1) return { save, id };
    }
  }
  throw new Error("no study run with a body after its giant");
})();

describe("GG-3 the study leg", () => {
  it("starts when the giant's scan completes, lasts studySeconds, the ship holds orbit and the scan clock pauses", () => {
    const { exp } = dispatch(crewed(SAVE), GIANT);
    const run = settled(exp);
    const legs = run.groundOps!.studyLegs!;
    const giant = run.bodies.findIndex((b) => isOrbitalPlanetType(b.planetType));
    expect(legs.map((l) => l.bodyIndex)).toEqual([giant]);
    const leg = legs[0];
    expect(leg.endsAt - leg.startsAt).toBe(studySeconds(run, run.bodies[giant]));
    expect(leg.done).toBe(true);
    expect(groundShipPosition(run, (leg.startsAt + leg.endsAt) / 2)).toEqual({ kind: "study", leg });
    // The last body here is the giant: nothing is left to scan, so the leg pauses nothing (scanBodyIndex null).
    expect(leg.scanBodyIndex).toBe(giant === run.bodies.length - 1 ? null : giant + 1);
    // The reward is one "study" finding.
    const found = run.findings.filter((f) => f.source === "study");
    expect(found.map((f) => f.id)).toEqual([`${run.id}-find-study-${giant}`]);
    expect(found[0]).toEqual(rollStudyReward(run, giant, leg.endsAt));
  });

  it("a study before the last body pauses the scan clock for its whole length; the next body's scan resumes after", () => {
    // A run whose giant is not the last body (BEFORE_LAST).
    const { exp } = dispatch(crewed(BEFORE_LAST.save), BEFORE_LAST.id);
    const run = settled(exp);
    const leg = run.groundOps!.studyLegs![0];
    expect(leg.scanBodyIndex).not.toBeNull();
    const ops = run.groundOps!;
    expect(scanClockAt(ops, leg.endsAt)).toBeCloseTo(scanClockAt(ops, leg.startsAt), 9);
    expect(scanClockAt(ops, leg.endsAt + 10)).toBeCloseTo(scanClockAt(ops, leg.startsAt) + 10, 9);
    // Without the stamp (a run dispatched before GG-2) there is no study and the next body finishes its scan sooner.
    const bare = settled(withoutStudy(exp));
    expect(bare.groundOps!.studyLegs).toBeUndefined();
  });

  it("the window closes only after every study is done, and the run then completes and claims", () => {
    const { next, exp } = dispatch(crewed(SAVE), GIANT);
    const done = advanceExpedition(exp, T0 + 4_000_000);
    expect(done.phase).toBe("complete");
    for (const l of done.groundOps!.studyLegs!) expect(done.groundOps!.endedAt!).toBeGreaterThanOrEqual(l.endsAt);
    const claim = claimExpedition({ ...next, expeditions: [done] }, done.id);
    expect(claim.success).toBe(true);
    const study = done.findings.find((f) => f.source === "study")!;
    for (const [id, q] of Object.entries(study.materials ?? {})) expect(Number(itemTotal(claim.next.inventory, id))).toBeGreaterThanOrEqual(Math.min(q, 1));
    expect(claim.next.discovered).toEqual(expect.arrayContaining(Object.keys(study.materials ?? {})));
  });

  it("a pickup that would dock while the ship holds orbit waits for the study's end (and only then)", () => {
    expect(studyPickupAt({}, 500)).toBe(500);
    const legs = [{ kind: "study" as const, bodyIndex: 1, scanBodyIndex: 2, startsAt: 100, endsAt: 400 }];
    expect(studyPickupAt({ studyLegs: legs }, 100)).toBe(100); // docks as the dive begins
    expect(studyPickupAt({ studyLegs: legs }, 101)).toBe(400);
    expect(studyPickupAt({ studyLegs: legs }, 400)).toBe(400);
    // Over real runs: every ordinary return that would land inside a study stored when it began ends with the study.
    let waited = 0;
    let returns = 0;
    for (let i = 0; i < 24; i++) {
      const state = crewed(makeExpeditionSeed(0x5ca1e, i));
      for (const c of expeditionCandidates(state, "ship-1")) {
        const { exp } = dispatch(state, c.id);
        if (!exp.study) continue;
        const run = advanceExpedition(exp, T0 + 4_000_000);
        const ops = run.groundOps!;
        for (const rec of ops.history) {
          if (rec.step !== "return" || rec.recovered) continue;
          returns += 1;
          const landing = rec.startedAt + RETURN_SECONDS;
          const holding = (ops.studyLegs ?? []).find((l) => l.startsAt <= rec.startedAt && l.startsAt < landing && landing < l.endsAt);
          if (holding) {
            waited += 1;
            expect(rec.endedAt).toBe(holding.endsAt);
          } else if (!(ops.shipLegs.some((l) => l.arrivesAt === rec.endedAt))) expect(rec.endedAt).toBe(landing);
        }
      }
    }
    expect(returns).toBeGreaterThan(20);
    expect(waited).toBeGreaterThan(0);
  });

  it("the study counts in the run's progress (weight 1) and only on a study run", () => {
    const { exp } = dispatch(crewed(SAVE), GIANT);
    const done = advanceExpedition(exp, T0 + 4_000_000);
    expect(groundOpsProgress(done, done.groundOps!.endedAt!)).toBe(1);
    const leg = done.groundOps!.studyLegs![0];
    const mid = Math.floor((leg.startsAt + leg.endsAt) / 2);
    const atMid = advanceExpedition(exp, mid);
    const midLeg = atMid.groundOps!.studyLegs![0];
    expect(midLeg.done).toBeUndefined();
    const end = advanceExpedition(exp, leg.endsAt);
    expect(groundOpsProgress(atMid, mid)).toBeLessThan(groundOpsProgress(end, leg.endsAt));
    // The study's share: the run's progress with the study weighted 1, its elapsed half counted.
    const without = groundOpsProgress({ ...atMid, study: undefined }, mid);
    expect(groundOpsProgress(atMid, mid)).not.toBe(without);
  });

  it("the training run (a fresh save's first expedition) with a gas giant still cannot be lost: it completes with its study", () => {
    const base = crewed(TRAINING.save);
    const fresh: GameState = { ...base, nextExpeditionId: 1 };
    const { next, exp } = dispatch(fresh, TRAINING.id);
    expect(exp.difficulty?.firstRun).toBeDefined();
    const done = advanceExpedition(exp, T0 + 6_000_000);
    expect(done.phase).toBe("complete");
    expect(done.findings.some((f) => f.source === "study")).toBe(true);
    for (const b of done.bodies) for (const a of b.activities) expect(a.status, a.id).toBe("done");
    expect(claimExpedition({ ...next, expeditions: [done] }, done.id).success).toBe(true);
  });

  it("offline == live: one call == 997 s chunks == 1 s steps, across the study's start and end", () => {
    for (const [save, id] of [[SAVE, GIANT], [BEFORE_LAST.save, BEFORE_LAST.id]] as const) {
      const { exp } = dispatch(crewed(save, true), id);
      const end = T0 + 4_000_000;
      const one = advanceExpedition(exp, end);
      let chunked = exp;
      for (let t = T0 + 997; t < end; t += 997) chunked = advanceExpedition(chunked, t);
      chunked = advanceExpedition(chunked, end);
      expect(chunked).toEqual(one);
      const leg = one.groundOps!.studyLegs![0];
      for (const edge of [leg.startsAt, leg.endsAt]) {
        const from = Math.floor(edge) - 300;
        let stepped = advanceExpedition(exp, from);
        for (let t = from + 1; t <= from + 600; t++) stepped = advanceExpedition(stepped, t);
        expect(stepped).toEqual(advanceExpedition(exp, from + 600));
      }
    }
  });
});

describe("GG-3 the study's length, the probe and the dive", () => {
  it("30 minutes with no Science member; the party's pace shortens it (a Galileo's fieldwork line on a giant); floored", () => {
    const giant = { planetType: "gasGiant" as const };
    expect(studySeconds({ roster: { security: [], science: [] }, scienceStrength: 0 }, giant)).toBe(STUDY_BASE_SECONDS);
    const plain = dispatch(crewed(SAVE), GIANT).exp;
    const probed = dispatch(crewed(SAVE, true), GIANT).exp;
    expect(studySeconds(probed, giant)).toBeLessThan(studySeconds(plain, giant));
    expect(studySeconds(plain, giant)).toBeLessThanOrEqual(STUDY_BASE_SECONDS);
    const huge = dispatch(crewed(SAVE, true, 1e7), GIANT).exp;
    expect(studySeconds(huge, giant)).toBe(STUDY_MIN_SECONDS);
  });

  it("studyProbe: the best Galileo aboard (by its crush rating), a reference one rates 1, none without", () => {
    expect(studyProbe(dispatch(crewed(SAVE), GIANT).exp)).toBeNull();
    const one = studyProbe(dispatch(crewed(SAVE, true), GIANT).exp)!;
    expect(one.memberId).toBe(SCI[0]);
    expect(one.hazardResist).toBeCloseTo(GALILEO_REFERENCE_LINES.hazardResist, 9);
    expect(one.relicFind).toBeCloseTo(GALILEO_REFERENCE_LINES.relicFind, 9);
    expect(one.diveRating).toBeCloseTo(1, 9);
    expect(one.relicRating).toBeCloseTo(1, 9);
    const two = withGalileo(crewed(SAVE, true), SCI[3], 60);
    const best = studyProbe(dispatch(two, GIANT).exp)!;
    expect(best.memberId).toBe(SCI[3]);
    expect(best.diveRating).toBeCloseTo(3, 9);
  });

  it("the dive is on the D23 curve: 0 without a probe, monotone in the rating and the depth, concave, never capped", () => {
    expect(studyDiveBonus(1.4, 0)).toBe(0);
    let prev = 0;
    let prevStep = Infinity;
    for (let r = 1; r <= 64; r *= 2) {
      const v = studyDiveBonus(1.4, r);
      expect(v).toBeGreaterThan(prev);
      const step = v - prev;
      if (r > 1) expect(step / r).toBeLessThan(prevStep);
      prevStep = step / r;
      prev = v;
    }
    expect(studyDiveBonus(1.4, 1e6)).toBeGreaterThan(studyDiveBonus(1.4, 1e5));
    expect(studyDiveBonus(4, 1)).toBeGreaterThan(studyDiveBonus(1, 1));
    // A heavier giant of the same class gives a deeper dive.
    expect(giantDepthFactor({ classId: "sudarskyI", massMilliJ: 8000 })).toBeGreaterThan(giantDepthFactor({ classId: "sudarskyI", massMilliJ: 500 }));
  });

  it("the canister haul scale: the dive x the tier haul; no probe pays the bare range", () => {
    const plain = dispatch(crewed(SAVE), GIANT).exp;
    const probed = dispatch(crewed(SAVE, true), GIANT).exp;
    const i = plain.bodies.findIndex((b) => isOrbitalPlanetType(b.planetType));
    expect(studyCanisterScale(plain, i)).toBe(1);
    expect(studyCanisterScale(probed, i)).toBeGreaterThan(1);
    // No probe still pays: at least the bare minimum every time; every roll lands inside the forecast range.
    for (const run of [plain, probed]) {
      const [lo, hi] = studyCanisterRange(run, i);
      for (let s = 1; s < 200; s++) {
        const mats = rollStudyReward({ ...run, seed: s * 7919 }, i, 0).materials ?? {};
        const n = GAS_CANISTER_IDS.reduce((sum, id) => sum + (mats[id] ?? 0), 0);
        expect(n).toBeGreaterThanOrEqual(Math.max(STUDY_CANISTERS_MIN, lo));
        expect(n).toBeLessThanOrEqual(hi);
      }
    }
    expect(studyCanisterRange(plain, i)).toEqual([STUDY_CANISTERS_MIN, 8]);
  });

  it("the Ancient Data Fragment's odds rise with the probe's relic line and the tier", () => {
    const at = (tier: RegionTier, rating: number) => ancientFragmentPermille({ region: { version: 1, tier, enemyTerritory: false, bearing: 0, distanceLy: 1 } }, rating);
    expect(at(1, 0)).toBe(ANCIENT_FRAGMENT_BASE_PERMILLE);
    expect(at(2, 0)).toBe(15);
    expect(at(2, 1)).toBeGreaterThanOrEqual(38);
    expect(at(2, 1)).toBeLessThanOrEqual(45);
    for (let tier = 1; tier < 7; tier++) expect(at((tier + 1) as RegionTier, 1)).toBeGreaterThan(at(tier as RegionTier, 1));
    expect(at(1, 10)).toBeGreaterThan(at(1, 1));
  });

  it("the probe dive seam: one event per finished study with a Galileo aboard, none without", () => {
    const probed = advanceExpedition(dispatch(crewed(SAVE, true), GIANT).exp, T0 + 4_000_000);
    const leg = probed.groundOps!.studyLegs![0];
    expect(studyDiveEvents(probed)).toEqual([{ bodyIndex: leg.bodyIndex, at: leg.endsAt, memberId: SCI[0], pieceId: `galileo-${SCI[0]}` }]);
    expect(studyDiveEvents(advanceExpedition(dispatch(crewed(SAVE), GIANT).exp, T0 + 4_000_000))).toEqual([]);
  });
});

describe("GG-3 the reward", () => {
  // A synthetic study of one giant of `classId` (Tier I, no probe): the reward roll's own inputs.
  const study = (classId: GiantClassId, seed: number) => ({
    id: "t",
    seed,
    systemName: "LB-0001",
    region: { version: 1 as const, tier: 1 as RegionTier, enemyTerritory: false, bearing: 0, distanceLy: 1 },
    roster: { security: [], science: [] },
    bodies: [{ id: "b", planetType: "gasGiant" as const, scanTotal: 1, scanProgress: 1, hazard: 0, scanned: true, discoveries: [], activities: [], giant: { classId, massMilliJ: GIANT_CLASSES.find((c) => c.id === classId)!.massMinMilliJ } }],
  });

  it("deterministic, keyed by the body: the same study rolls the same reward", () => {
    for (let s = 1; s < 50; s++) expect(rollStudyReward(study("sudarskyI", s), 0, 5)).toEqual(rollStudyReward(study("sudarskyI", s), 0, 5));
  });

  it("over 2,000 studies per class: canister bands within tolerance of the class odds, data 40%, readout 15%", () => {
    for (const c of GIANT_CLASSES) {
      const bands: Record<string, number> = { standard: 0, augmented: 0, stellar: 0, radiant: 0 };
      let canisters = 0;
      let data = 0;
      let survey = 0;
      const families = new Set<string>();
      for (let s = 1; s <= 2000; s++) {
        const f = rollStudyReward(study(c.id, s * 0x9e3779b1), 0, 0);
        for (const id of GAS_CANISTER_IDS) {
          const q = f.materials?.[id] ?? 0;
          canisters += q;
          bands[ITEMS[id].band!] += q;
        }
        for (const fam of RESEARCH_FAMILIES) if (f.materials?.[RESEARCH_DATA_ITEM[fam]]) {
          data += 1;
          families.add(fam);
        }
        if (f.survey) {
          survey += 1;
          expect(f.survey.kind).toBe("giant");
          if (f.survey.kind === "giant") expect(f.survey.classId).toBe(c.id);
          if (f.survey.kind === "giant") expect(f.survey.bodyName).toBe("LB-0001 b");
        }
      }
      for (const b of ITEM_BANDS) expect(Math.abs(bands[b] / canisters - c.bandOdds[b] / 100), `${c.id} ${b}`).toBeLessThan(0.02);
      expect(Math.abs(data / 2000 - STUDY_RESEARCH_DATA_PERMILLE / 1000), c.id).toBeLessThan(0.035);
      expect(Math.abs(survey / 2000 - STUDY_SURVEY_READOUT_PERMILLE / 1000), c.id).toBeLessThan(0.025);
      expect(families.size, c.id).toBe(RESEARCH_FAMILIES.length);
    }
  });

  it("the fragment appears at its odds (Tier I, no probe: the base per-mille)", () => {
    let n = 0;
    for (let s = 1; s <= 20000; s++) if (rollStudyReward(study("brownDwarf", s * 2654435761), 0, 0).materials?.[ANCIENT_DATA_FRAGMENT_ID]) n += 1;
    expect(Math.abs(n / 20000 - ANCIENT_FRAGMENT_BASE_PERMILLE / 1000)).toBeLessThan(0.003);
  });

  it("the claim deposits the canisters and data, and appends the readout to the Survey Log", () => {
    const s = freshState();
    let f = rollStudyReward(study("iceGiant", 1), 0, 42);
    for (let seed = 1; !f.survey; seed++) f = rollStudyReward(study("iceGiant", seed), 0, 42);
    const next = depositExpeditionFindings(s, [f]);
    expect(next.surveyLog).toEqual([f.survey]);
    for (const [id, q] of Object.entries(f.materials ?? {})) expect(itemTotal(next.inventory, id).eq(new Decimal(q))).toBe(true);
    // A save without a readout keeps no surveyLog key.
    const plain = rollStudyReward(study("iceGiant", 2), 0, 0);
    if (!plain.survey) expect("surveyLog" in depositExpeditionFindings(s, [plain])).toBe(false);
  });
});
