// Gas Giant Study GG-6 (plan docs/plans/2026-10-17-gas-giant-study-plan.md section 4 GG-6; the signed-off v3 mockup,
// "approve as is" 2026-10-21): the study screens' display decisions. Every number they print is the engine's
// (gasGiantStudy.ts, gasGiantContent.ts), never the mockup's sample numbers.

import { describe, expect, it } from "vitest";
import {
  BLUEPRINTS,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  freshState,
  type AwayMember,
  type EquipmentInstance,
  type Expedition,
  type GameState,
  type ShipGroundTeam,
  type SurveyLogEntry,
} from "./game/model";
import { advanceExpedition, flaggedScanTimeline } from "./game/expedition";
import { RETURN_SECONDS, groundShipPosition } from "./game/groundOps";
import { GAS_CANISTER_IDS, GIANT_CLASSES, NEBULA_KINDS, giantClassById, giantClassDisplayName, giantPhysics, type GiantClassId } from "./game/gasGiantContent";
import {
  NEBULA_SWEEP_SECONDS,
  STUDY_CANISTERS_MAX,
  STUDY_CANISTERS_MIN,
  giantDepthFactor,
  isStudyBody,
  nebulaCanisterRange,
  studyCanisterRange,
  studyProbe,
  studySeconds,
} from "./game/gasGiantStudy";
import { tierHaulMult } from "./game/riskFactors";
import { dispatchPastPropulsion, plainAwayMember } from "./game/awayTeamTestFixtures";
import {
  GALILEO_CRUSH_BAR_PER_RATING,
  GIANT_ART,
  NEBULA_ART,
  SURVEY_LOG_LIVE,
  archiveSubTabs,
  bandRangeText,
  canisterChances,
  canisterDetailView,
  clockText,
  demandStudyChips,
  giantCardView,
  massText,
  minLeftText,
  minText,
  nebulaRowView,
  onWarehouseShelf,
  orbitCanisterRange,
  percentText,
  starBarView,
  studyBodyView,
  studyClaimLine,
  studyForecastText,
  studyLegsView,
  studyResultsView,
  studyShipCardView,
  studySummaryChips,
  surveyEntryView,
  surveyLogGroups,
} from "./gasGiantStudyDisplay";
import { timelineView } from "./groundOpsTimelineDisplay";
import { scanTrackView } from "./scanTrackDisplay";
import { telescopeBlockView } from "./expeditionDispatchDisplay";

const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const T0 = 100_000;

// ship-1 with two Ground teams of six rank 10 members, the telescope at Level 8; `galileo` puts a reference Galileo-Class
// Probe (20 points at the variety's ratios) on the first Science member (the gasGiantStudyLeg.test.ts fixture).
function crewed(galileo: boolean): GameState {
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
    facilities: { ...base.facilities, [SUBSPACE_TELESCOPE_FACILITY_KEY]: { level: 8 } },
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  };
  if (!galileo) return s;
  const points = 20;
  const piece = {
    id: "galileo-1",
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
    fittedToMemberId: SCI[0],
  } as unknown as EquipmentInstance;
  return { ...s, equipment: [...s.equipment, piece] };
}

// The GG-0 gas giant system (a fresh save's candidate 2; it holds a nebula since GG-4).
const GIANT = "cand-1-2";
function dispatchGiant(galileo: boolean): Expedition {
  const res = dispatchPastPropulsion(crewed(galileo), "ship-1", 1, GIANT);
  if (!res.success || !res.expedition) throw new Error(`dispatch refused: ${res.reason}`);
  return res.expedition;
}

// The run advanced to the first instant its ship holds orbit on a giant's study (600 s steps, then 10 s steps).
function atFirstStudy(exp: Expedition): { run: Expedition; now: number } {
  let run = exp;
  let t = exp.phaseAnchorSeconds;
  for (; t < exp.phaseAnchorSeconds + 2_000_000; t += 600) {
    run = advanceExpedition(run, t);
    const leg = (run.groundOps?.studyLegs ?? []).find((l) => l.nebula !== 1);
    if (leg && t >= leg.startsAt && t < leg.endsAt) return { run, now: t };
    if (leg && t >= leg.endsAt) {
      // Stepped past it: step back to its middle with a fresh walk (stored legs are pure functions of stored values).
      const mid = Math.floor((leg.startsAt + leg.endsAt) / 2);
      return { run: advanceExpedition(exp, mid), now: mid };
    }
  }
  throw new Error("no study reached");
}

function settled(exp: Expedition): Expedition {
  let run = exp;
  const done = (r: Expedition) => r.groundOps?.endedAt !== undefined;
  for (let t = exp.phaseAnchorSeconds + 600; t < exp.phaseAnchorSeconds + 8_000_000 && !done(run); t += 600) run = advanceExpedition(run, t);
  return run;
}

// An em dash, an en dash, or two hyphens in a row (written as escapes so this file holds none of them).
const DASH = new RegExp("\\u2014|\\u2013|-{2}");

describe("GG-6 words", () => {
  it("prints spans in the mockup's minutes and hours", () => {
    expect(minText(45)).toBe("45 s");
    expect(minText(1080)).toBe("18 min");
    expect(minText(7200)).toBe("2 h");
    expect(minText(4380)).toBe("1 h 13 min");
    expect(minText(3599)).toBe("1 h");
    expect(minLeftText(1000, 1000 - 9 * 60 + 30)).toBe("9 min left");
    expect(minLeftText(1000, 1000 - 30)).toBe("30 s left");
    expect(minLeftText(1000, 1000)).toBe("ending now");
    expect(clockText(55 * 60)).toBe("0:55");
    expect(clockText(73 * 60 + 59)).toBe("1:13");
  });

  it("prints a giant's mass as its own number (the ice giant also in Earth masses)", () => {
    expect(massText(2400)).toBe("2.40 Jupiter masses");
    expect(massText(52)).toBe("0.052 Jupiter masses (about 17 Earth masses)");
    expect(massText(31_000)).toBe("31.0 Jupiter masses");
  });

  it("percents: whole from 1%, one decimal from 0.1%, two below", () => {
    expect(percentText(18.46)).toBe("18%");
    expect(percentText(0.4)).toBe("0.4%");
    expect(percentText(0.0667)).toBe("0.07%");
  });
});

describe("GG-6 how close to a star", () => {
  it("reads the shares of the 13 and 78 Jupiter-mass lines off the stored mass", () => {
    const j = starBarView(2400);
    expect(j.deuteriumText).toBe("18%");
    expect(j.fusionText).toBe("3%");
    expect(j.verdict).toMatch(/^About .* of the way to burning deuterium\.$/);
    const ice = starBarView(52);
    expect(ice.deuteriumText).toBe("0.4%");
    expect(ice.fusionText).toBe("0.07%");
    expect(ice.verdict).toBe("Nowhere near a star.");
    const bd = starBarView(31_000);
    expect(bd.deuteriumText).toBe("238%");
    expect(bd.fusionText).toBe("40%");
    expect(bd.verdict).toMatch(/crossed the first line/);
  });

  it("puts the pin on the log scale between the two lines, in order", () => {
    const v = starBarView(31_000);
    expect(v.deuteriumLinePct).toBeLessThan(v.pinPct);
    expect(v.pinPct).toBeLessThan(v.fusionLinePct);
    expect(starBarView(52).pinPct).toBeLessThan(starBarView(2400).pinPct);
  });
});

describe("GG-6 band odds and the chance per canister", () => {
  it("every class and kind: the per-canister chances sum to 100 and follow the band odds x the weights", () => {
    for (const def of [...GIANT_CLASSES, ...NEBULA_KINDS]) {
      const c = canisterChances(def.bandOdds, def.itemWeights);
      const sum = GAS_CANISTER_IDS.reduce((a, id) => a + c[id], 0);
      expect(sum, def.id).toBeCloseTo(100, 9);
    }
    const i = canisterChances(GIANT_CLASSES[0].bandOdds, GIANT_CLASSES[0].itemWeights);
    expect(i.hydrogenCanister).toBeCloseTo((66 * 3) / 4, 9);
    expect(i.antimatterCell).toBeCloseTo(2, 9);
  });

  it("names a kind's band range; nebulae never reach Radiant", () => {
    expect(bandRangeText(NEBULA_KINDS.find((k) => k.id === "emissionNebula")!.bandOdds)).toBe("Standard to Stellar canisters");
    expect(bandRangeText(GIANT_CLASSES[0].bandOdds)).toBe("Standard to Radiant canisters");
    for (const k of NEBULA_KINDS) expect(bandRangeText(k.bandOdds)).not.toMatch(/Radiant/);
  });

  it("draws every class and kind (the art tables are complete)", () => {
    for (const c of GIANT_CLASSES) expect(GIANT_ART[c.id].palette.length, c.id).toBe(5);
    for (const k of NEBULA_KINDS) expect(NEBULA_ART[k.id].length, k.id).toBe(3);
  });
});

describe("GG-6 the scan section's study rows", () => {
  const exp = dispatchGiant(true);
  const plain = dispatchGiant(false);

  it("an orbital body of a study run gets a study row; every other body none", () => {
    exp.bodies.forEach((b, i) => {
      const v = studyBodyView(exp, i, exp.phaseAnchorSeconds);
      expect(v !== null, `body ${i}`).toBe(isStudyBody(exp, b));
    });
    expect(exp.bodies.some((b) => isStudyBody(exp, b))).toBe(true);
  });

  it("the row says it is orbital, the engine's study time, the Galileo dive only with a probe, and its state", () => {
    const i = exp.bodies.findIndex((b) => isStudyBody(exp, b));
    const v = studyBodyView(exp, i, exp.phaseAnchorSeconds)!;
    const texts = v.chips.map((c) => c.text);
    expect(texts[0]).toBe("Orbital: no ground objectives");
    expect(texts).toContain(`Ship study ${minText(studySeconds(exp, exp.bodies[i]))}`);
    expect(texts).toContain("Galileo dive");
    expect(texts).toContain("Queued");
    expect(studyBodyView(plain, i, plain.phaseAnchorSeconds)!.chips.map((c) => c.text)).not.toContain("Galileo dive");
    expect(v.name).toBe(giantClassDisplayName(giantClassById(exp.bodies[i].giant!.classId)!));
  });

  it("the nebula row: a 2 h sweep, no probe, its band range; none without a nebula", () => {
    expect(exp.nebula).toBeDefined();
    const n = nebulaRowView(exp, exp.phaseAnchorSeconds)!;
    expect(n.chips[0].text).toBe(`Nebula sweep ${minText(NEBULA_SWEEP_SECONDS)}`);
    expect(n.chips.map((c) => c.text)).toContain("No probe used");
    expect(nebulaRowView({ ...exp, nebula: undefined }, exp.phaseAnchorSeconds)).toBeNull();
  });

  it("the summary chips count the studies and the sweep; a run with neither shows none", () => {
    const texts = studySummaryChips(exp).map((c) => c.text);
    expect(texts).toContain(`${exp.bodies.filter((b) => isStudyBody(exp, b)).length === 1 ? "1 ship study" : `${exp.bodies.filter((b) => isStudyBody(exp, b)).length} ship studies`}`);
    expect(texts).toContain("1 nebula sweep");
    expect(texts[texts.length - 1]).toBe("Studies need no squad");
    expect(studySummaryChips({ bodies: exp.bodies, study: undefined, nebula: undefined })).toEqual([]);
  });
});

describe("GG-6 the gas giant body card (every number the engine's)", () => {
  const exp = dispatchGiant(true);
  const plain = dispatchGiant(false);
  const i = exp.bodies.findIndex((b) => isStudyBody(exp, b));

  it("physics from the stored class and mass", () => {
    const v = giantCardView(exp, i)!;
    const g = exp.bodies[i].giant!;
    const phys = giantPhysics(giantClassById(g.classId)!, g.massMilliJ);
    expect(v.kv.find((r) => r.label === "Mass")!.value).toBe(massText(g.massMilliJ));
    expect(v.kv.find((r) => r.label === "Density")!.value).toBe(`${phys.densityGcm3.toFixed(2)} g/cm3 (water is 1)`);
    expect(v.star.deuteriumText).toBe(starBarView(g.massMilliJ).deuteriumText);
  });

  it("the haul is studyCanisterRange with the probe and the base x tier haul from orbit", () => {
    const v = giantCardView(exp, i)!;
    const [lo, hi] = studyCanisterRange(exp, i);
    expect(v.haulText).toBe(`${lo} to ${hi} canisters`);
    const t = tierHaulMult(exp.region);
    expect(orbitCanisterRange(exp)).toEqual([Math.floor(STUDY_CANISTERS_MIN * t), Math.ceil(STUDY_CANISTERS_MAX * t)]);
    const p = giantCardView(plain, i)!;
    expect(p.haulText).toBe(`${orbitCanisterRange(plain)[0]} to ${orbitCanisterRange(plain)[1]} canisters`);
    expect(studyCanisterRange(plain, i)).toEqual(orbitCanisterRange(plain));
  });

  it("the crush rating and dive depth read the probe's dive rating x the giant's depth factor", () => {
    const v = giantCardView(exp, i)!;
    const probe = studyProbe(exp)!;
    const depth = giantDepthFactor(exp.bodies[i].giant!);
    expect(v.probeRows[0].value).toBe(`${Math.round(GALILEO_CRUSH_BAR_PER_RATING * probe.diveRating)} bar at Jupiter gravity (hazard resist line)`);
    expect(v.probeRows[1].value).toBe(`x${depth.toFixed(2)} from gravity`);
    expect(v.column.diveText).toBe(`Dive depth ~${Math.round(GALILEO_CRUSH_BAR_PER_RATING * probe.diveRating * depth).toLocaleString("en-US")} bar`);
    const p = giantCardView(plain, i)!;
    expect(p.column.diveFrac).toBeNull();
    expect(p.probeRows[0].value).toMatch(/No Galileo-Class Probe/);
  });

  it("is null for a body with a surface", () => {
    const ground = exp.bodies.findIndex((b) => !isStudyBody(exp, b));
    if (ground >= 0) expect(giantCardView(exp, ground)).toBeNull();
  });
});

describe("GG-6 the ship holding orbit, the ship legs, the timeline", () => {
  const exp = dispatchGiant(true);
  const { run, now } = atFirstStudy(exp);
  const leg = run.groundOps!.studyLegs!.find((l) => l.nebula !== 1)!;
  const names = (id: string) => (id === SCI[0] ? "Lt. Reyes" : null);

  it("the card shows exactly while the ship holds orbit on a study", () => {
    expect(groundShipPosition(run, now).kind).toBe("study");
    const card = studyShipCardView(run, null, now, names)!;
    expect(card.title).toBe(`Ship holding orbit at ${run.systemName} ${String.fromCharCode(98 + leg.bodyIndex)}`);
    expect(card.left).toBe(minLeftText(leg.endsAt, now));
    expect(card.chips[0].text).toBe("Galileo-Class Probe, Lt. Reyes (Science)");
    // Past the study: no giant card (the sweep's own card when the ship goes straight on to the nebula).
    const after = studyShipCardView(run, null, leg.endsAt + 1, names);
    const sweeping = run.groundOps!.studyLegs!.some((l) => l.nebula === 1 && l.startsAt <= leg.endsAt + 1 && leg.endsAt + 1 < l.endsAt);
    if (sweeping) expect(after!.title).toMatch(/^Ship sweeping the /);
    else expect(after).toBeNull();
  });

  it("a shuttle that docks at the study's end is named as waiting", () => {
    const ops = structuredClone(run.groundOps!);
    ops.teams[0] = { ...ops.teams[0], step: "return", stepStartedAt: leg.startsAt + 10, stepEndsAt: leg.endsAt };
    const waiting = { ...run, groundOps: ops };
    const card = studyShipCardView(waiting, null, now, names)!;
    expect(card.waits.length).toBe(1);
    expect(card.waits[0]).toMatch(/Pickup waits for the ship: \d+ min\.$/);
    // The team lane draws the shuttle, then a hatched "pickup waits".
    const view = timelineView(waiting, null, Math.max(now, leg.startsAt + 10 + RETURN_SECONDS + 5), "whole", flaggedScanTimeline)!;
    expect(view.lanes[0].segments.some((s) => s.category === "wait")).toBe(true);
    expect(view.hasStudies).toBe(true);
  });

  it("the ship lane draws each stored study leg; the legs card lists it with its window times", () => {
    const view = timelineView(run, null, now, "whole", flaggedScanTimeline)!;
    expect(view.ship.segments.some((s) => s.category === "study" && s.current)).toBe(true);
    const legs = studyLegsView(run, null, now, flaggedScanTimeline)!;
    const start = run.groundOps!.startedAt!;
    const row = legs.rows.find((r) => r.key === `study-${leg.bodyIndex}`)!;
    expect(row.when).toBe(`${clockText(leg.startsAt - start)} to ${clockText(leg.endsAt - start)}, under way`);
    expect(row.current).toBe(true);
    // The sweep is listed once: stored (its window times) or still ahead.
    if (run.nebula) expect(legs.rows.filter((r) => r.key === "sweep-ahead" || r.key === "sweep").length).toBe(1);
  });

  it("the forecast sums the engine's ranges", () => {
    let lo = 0;
    let hi = 0;
    run.bodies.forEach((b, i) => {
      if (!isStudyBody(run, b)) return;
      const [a, z] = studyCanisterRange(run, i);
      lo += a;
      hi += z;
    });
    const text = studyForecastText(run);
    expect(text.startsWith(`On return (forecast): ${lo} to ${hi} canisters from the `)).toBe(true);
    if (run.nebula) expect(text).toContain(`${nebulaCanisterRange(run)[0]} to ${nebulaCanisterRange(run)[1]} from the sweep`);
    expect(text).toContain("research data at 40% per study");
    expect(text).toContain("a Survey Log readout at 15%");
  });
});

describe("GG-6 the study results and the claim line", () => {
  const done = settled(dispatchGiant(true));

  it("every study and sweep finding gets a results row; the claim line names the studies, never the haul again", () => {
    const rows = studyResultsView(done);
    const studies = done.findings.filter((f) => f.source === "study");
    expect(rows.length).toBe(studies.length);
    expect(rows.length).toBeGreaterThan(0);
    const line = studyClaimLine(done.findings)!;
    const giants = studies.filter((f) => !f.id.endsWith("-find-nebula")).length;
    expect(line.startsWith(`Ship studies: ${giants} gas giant`)).toBe(true);
    if (done.nebula) expect(line).toContain("1 nebula sweep");
    // The "Findings claimed" line already lists every canister: none named here.
    expect(line).not.toMatch(/Canister|canister/);
    // The Survey Log is live (signed off 2026-10-27): the line counts the readouts, and says nothing when none hit.
    const readouts = studies.filter((f) => f.survey).length;
    if (readouts > 0) expect(line).toContain(readouts === 1 ? "1 Survey Log readout" : `${readouts} Survey Log readouts`);
    else expect(line).not.toMatch(/Survey Log/);
    const noReadout = studyClaimLine(studies.map((f) => ({ ...f, survey: undefined })))!;
    expect(noReadout).not.toMatch(/Survey Log/);
    expect(studyClaimLine(done.findings.filter((f) => f.source !== "study"))).toBeNull();
  });

  it("the summary chips add the mockup's ground objectives count once every body is scanned", () => {
    const texts = studySummaryChips(done).map((c) => c.text);
    const n = done.bodies.reduce((a, b) => a + b.activities.length, 0);
    expect(texts).toContain(`${n} ground objective${n === 1 ? "" : "s"}`);
  });

  it("a resumed run counts only what it still studies (a giant studied before, a nebula swept before)", () => {
    const resumed = {
      ...done,
      bodies: done.bodies.map((b) => (isStudyBody(done, b) ? { ...b, studied: true as const } : b)),
      nebula: done.nebula ? { ...done.nebula, swept: 1 as const } : undefined,
    };
    expect(studySummaryChips(resumed)).toEqual([]);
  });
});

describe("GG-6 the Survey Log", () => {
  const giant = (id: string, classId: GiantClassId, at: number, mass = 2400): SurveyLogEntry => ({
    id,
    at,
    systemName: "OR-2817",
    bodyName: `OR-2817 ${id}`,
    kind: "giant",
    classId,
    massMilliJ: mass,
    tier: 2,
  });
  const entries: SurveyLogEntry[] = [
    giant("d", "sudarskyI", 100),
    giant("e", "iceGiant", 200, 52),
    giant("f", "sudarskyI", 300, 5000),
    { id: "n", at: 400, systemName: "OR-2817", kind: "nebula", kindId: "emissionNebula", tier: 2 },
  ];

  it("groups by class (content order) then kind, with counts, newest first, the oldest marked first", () => {
    const g = surveyLogGroups(entries);
    expect(g.map((x) => [x.key, x.count])).toEqual([
      ["sudarskyI", 2],
      ["iceGiant", 1],
      ["emissionNebula", 1],
    ]);
    expect(g[0].entries.map((e) => e.id)).toEqual(["f", "d"]);
    expect(g[0].entries.map((e) => e.first)).toEqual([false, true]);
  });

  it("the entry card derives from the stored class and mass; a nebula reads its life-cycle stage", () => {
    const d = surveyEntryView(entries[0], entries);
    expect(d.first).toBe(true);
    expect(d.subtitle).toBe("Ammonia-cloud giant, Sudarsky I · Tier II");
    expect(d.star!.deuteriumText).toBe("18%");
    const f = surveyEntryView(entries[2], entries);
    expect(f.first).toBe(false);
    const n = surveyEntryView(entries[3], entries);
    expect(n.stage).toBe(NEBULA_KINDS.find((k) => k.id === "emissionNebula")!.stage);
    expect(n.star).toBeNull();
  });
});

describe("GG-6 the launch preview and the scan track", () => {
  it("the demand's studies become chips; the demand line leaves them out", () => {
    expect(demandStudyChips({ shipStudies: 2, nebulaSweep: 1 }).map((c) => c.text)).toEqual(["2 ship studies", "1 nebula sweep", "Studies need no squad"]);
    expect(demandStudyChips({ shipStudies: 0 })).toEqual([]);
    expect(demandStudyChips(null)).toEqual([]);
  });

  it("the telescope block's demand line never repeats the chips", () => {
    const c = {
      telescope: {
        blind: false,
        risk: { factors: { combat: { grade: 1, present: true }, fauna: { grade: 0, present: false }, flora: { grade: 0, present: false }, hazard: { grade: 1, present: true } }, bodies: null },
        detail: 3,
        detailName: "Per body",
        regionTier: 1,
        distanceLy: 10,
        rangeLy: 100,
        shipLift: false,
        demand: { bodies: 3, securityBodies: 1, tasks: 4, noSecurityTasks: 1, twoSecurityTasks: 0, twoScienceTasks: 0, maxSecurity: 1, maxScience: 1, shipStudies: 2, nebulaSweep: 1 },
      },
      foreknowledge: { inRange: true, bodies: [] },
    } as unknown as Parameters<typeof telescopeBlockView>[0];
    const b = telescopeBlockView(c, 3);
    expect(b.demandText).not.toMatch(/ship stud|no squad/);
    expect(b.studyChips.map((x) => x.text)).toEqual(["2 ship studies", "1 nebula sweep", "Studies need no squad"]);
  });

  it("a sensor ghost read true over an orbital body adds no ground find, and says so", () => {
    const exp = dispatchGiant(true);
    const i = exp.bodies.findIndex((b) => isStudyBody(exp, b));
    const run = {
      ...exp,
      encounterSteps: 10,
      scanEvents: [{ kind: "shipEvent", event: "ghost", bodyIndex: i, step: 3, outcome: "pass", bonusDiscovery: true }],
    } as unknown as Expedition;
    const pip = scanTrackView(run, i)!.pips[0];
    expect(pip.sentence).toBe("Sensor ghost: the sensors read it true; an orbital body has no ground finds to add.");
  });
});

describe("GG-6 the canister shelf", () => {
  it("each canister's uses are exactly the blueprints whose recipe takes it", () => {
    for (const id of GAS_CANISTER_IDS) {
      const v = canisterDetailView(id);
      const users = Object.values(BLUEPRINTS).filter((bp) => (bp.recipe?.inputs?.[id] ?? 0) > 0);
      if (users.length > 0) for (const bp of users) expect(v.usedIn, id).toContain(bp.label);
      else expect(v.usedIn).toMatch(/No recipe takes it yet/);
    }
  });

  it("the Deuterium Canister names its Refinery recipe; the cell comes from giants only", () => {
    expect(canisterDetailView("deuteriumCanister").refinery).toMatch(/^Refinery: Deuterium Ice x10 to Deuterium Canister x1$/);
    expect(canisterDetailView("antimatterCell").source).toBe("Gas giant study only (nebulae hold none)");
    expect(canisterDetailView("hydrogenCanister").source).toBe("Gas giant study, nebula sweep");
  });

  it("research data has no warehouse shelf; every other item keeps its own", () => {
    expect(onWarehouseShelf("propulsionData")).toBe(false);
    expect(onWarehouseShelf("ancientDataFragment")).toBe(false);
    expect(onWarehouseShelf("hydrogenCanister")).toBe(true);
    expect(onWarehouseShelf("commonOre")).toBe(true);
  });
});

describe("GG-6 review: the Survey Log ships after its own mockup sign-off (user 2026-10-27)", () => {
  it("the Archive tab list carries the Survey Log now that it is live, and leaves it out when not", () => {
    expect(SURVEY_LOG_LIVE).toBe(true);
    expect(archiveSubTabs().map((t) => t.key)).toEqual(["archive", "museum", "surveyLog"]);
    expect(archiveSubTabs(false).map((t) => t.key)).toEqual(["archive", "museum"]);
    expect(archiveSubTabs(true).map((t) => t.key)).toEqual(["archive", "museum", "surveyLog"]);
  });
});

describe("GG-6 text rules", () => {
  it("no em dash, en dash or double hyphen in any study screen's words", () => {
    const exp = dispatchGiant(true);
    const { run, now } = atFirstStudy(exp);
    const words: string[] = [];
    run.bodies.forEach((_, i) => {
      const v = studyBodyView(run, i, now);
      if (v) words.push(v.name, v.massText, ...v.chips.map((c) => c.text));
      const g = giantCardView(run, i);
      if (g) words.push(g.feature, g.haulText, g.haulNote, g.oddsNote, g.bandsText, g.star.verdict, ...g.kv.map((r) => r.value), ...g.probeRows.map((r) => r.value), ...g.column.layers.map((l) => l.label));
    });
    const card = studyShipCardView(run, null, now, () => "Reyes");
    if (card) words.push(card.title, card.lead, card.tail, ...card.waits);
    const legs = studyLegsView(run, null, now, flaggedScanTimeline);
    if (legs) words.push(legs.forecast, ...legs.rows.map((r) => `${r.label} ${r.when} ${r.then ?? ""}`));
    for (const id of GAS_CANISTER_IDS) {
      const d = canisterDetailView(id);
      words.push(d.source, d.usedIn, d.refinery ?? "");
    }
    for (const w of words) {
      expect(w, w).not.toMatch(DASH);
      expect(w, w).not.toMatch(/\bfit(ting|ted)?\b/i);
    }
  });
});
