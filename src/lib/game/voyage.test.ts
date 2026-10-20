// Expedition Tiers G2-3 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-3): THE VOYAGE ENGINE.
//
// Proven here: the transit table per tier and drive class (user G5: I 2 h to VII 168 h, halved per class above the
// tier's minimum, a 30 minute floor); the band scale (user G21: distance shifts time only inside a tier); a dispatch
// stamps the voyage and the run flies it (outbound, the anomaly roll at half the outbound leg and its detour, the
// return leg, the Flight Deck ramp on it); each leg at the ship's own speed on it (CP-2 OC-E5: Fast Departure out,
// Fast Return back, the Pilot's sweeping cut on both); the training run's own nominal; offline == live on Tier I, IV
// and VII runs with Ground Ops, the anomaly, a field repair and the Flight Deck ramp; the speed seam's time skip
// finishes a voyage run at its natural end. Legacy runs (no voyage): voyageGoldens.test.ts and the G2-0 goldens.

import { describe, expect, it } from "vitest";
import { freshState, type AwayMember, type Expedition, type GameState, type RegionTier, type ShipDerivedStats, type ShipGroundTeam } from "./model";
import { ANOMALY_CHECK_FRACTION, TRANSIT_SECONDS, advanceExpedition, candidateSystemById, candidateVoyage, returnDurationSeconds, startExpedition } from "./expedition";
import {
  STANDARD_DRIVE_CLASS,
  TIER_TRANSIT_HOURS,
  TUTORIAL_TRANSIT_SECONDS,
  VOYAGE_ANOMALY_DETOUR_PERMILLE,
  VOYAGE_BAND_SCALE_PERMILLE,
  VOYAGE_FLOOR_SECONDS,
  planVoyage,
  tierNominalSeconds,
  voyageBandScalePermille,
  voyageClassSteps,
  voyageLegSeconds,
  voyageOf,
} from "./voyage";
import { REGION_TIERS, stateHomeworld } from "./galaxy";
import { applyTimeSkip } from "./processSpeed";
import { constitutionRamp } from "./constitutionRamp";
import { FIELD_REPAIR_DAMAGE_SHARE } from "./groundOps";
import { effectiveShipStats } from "./crewOverlay";
import { asExpeditionVeteran, plainAwayMember } from "./awayTeamTestFixtures";
import { bucketOf, dispatchRun, seatOfficer, wiringBase, withBuckets } from "./wiring/probes";

const T0 = 100_000;
const FINAL = T0 + 4_000_000;
const PHASES = ["transit", "scanning", "activities", "return", "complete"];
const SEC = ["member-1", "member-2", "member-3", "member-4", "member-5", "member-6"];
const SCI = ["member-11", "member-12", "member-13", "member-14", "member-15", "member-16"];
const BAND = { near: 100, far: 300 };
const speedSheet = (transitSpeedMult: number, out?: number, back?: number): ShipDerivedStats =>
  ({ transitSpeedMult, ...(out !== undefined ? { transitOutLegMult: out } : {}), ...(back !== undefined ? { transitBackLegMult: back } : {}) }) as ShipDerivedStats;

// A veteran's General Freighter with two Ground teams of rank 10 members, the clock at T0, on expedition seed `seed`.
function crewed(seed?: number): GameState {
  const base = freshState();
  const m = (id: string, t: AwayMember["teamType"]): AwayMember => ({ ...plainAwayMember(id, t, "ship-1"), rank: 10 as AwayMember["rank"] });
  const teams: ShipGroundTeam[] = [
    { kind: "ground", security: SEC.slice(0, 3), science: SCI.slice(0, 3), helpOthers: false },
    { kind: "ground", security: SEC.slice(3), science: SCI.slice(3), helpOthers: false },
  ];
  return asExpeditionVeteran({
    ...base,
    gameTimeSeconds: T0,
    nextExpeditionId: 2,
    ...(seed !== undefined ? { expeditionSeed: seed } : {}),
    awayMembers: [...SEC.map((id) => m(id, "security")), ...SCI.map((id) => m(id, "science"))],
    nextAwayMemberId: 100,
    ships: base.ships.map((sh) => ({ ...sh, groundTeams: teams })),
  });
}

function dispatch(state: GameState, tier: RegionTier, slot = 0): Expedition {
  const res = startExpedition(state, "ship-1", 1, `cand-${tier}-${slot}`);
  expect(res.success, String(res.reason)).toBe(true);
  return res.expedition!;
}

// An expedition seed whose Tier I, IV and VII slot 0 runs all finish (a rank 10 crew can still stall on a vault: the
// Ground Ops balance finding), found once.
let foundSeed: number | undefined;
function goodSeed(): number {
  if (foundSeed !== undefined) return foundSeed;
  for (let k = 0; k < 40; k++) {
    const seed = 0x2468ace + k * 104_729;
    if (([1, 4, 7] as const).every((t) => advanceExpedition(dispatch(crewed(seed), t), FINAL).phase === "complete")) return (foundSeed = seed);
  }
  throw new Error("no finishing seed");
}
// The instant the run first leaves `phase` (walking 50 s chunks). Pure.
function leaves(exp: Expedition, phase: string): number {
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 50; t < FINAL; t += 50) {
    e = advanceExpedition(e, t);
    if (e.phase !== phase) return e.phaseAnchorSeconds;
  }
  throw new Error(`never left ${phase}`);
}

function chunked(exp: Expedition, from: number, to: number, step: number): Expedition {
  let e = exp;
  for (let t = from + step; t < to; t += step) e = advanceExpedition(e, t);
  return advanceExpedition(e, to);
}

function timeline(exp: Expedition): [string, number][] {
  const out: [string, number][] = [[exp.phase, exp.phaseAnchorSeconds]];
  let e = exp;
  for (let t = exp.phaseAnchorSeconds + 101; e.phase !== "complete" && t < FINAL; t += 101) {
    e = advanceExpedition(e, t);
    if (out[out.length - 1][0] !== e.phase) out.push([e.phase, e.phaseAnchorSeconds]);
  }
  expect(out.map(([p]) => p)).toEqual(PHASES);
  return out;
}
const anchorOf = (tl: [string, number][], phase: string): number => tl.find(([p]) => p === phase)![1];

function eventTimes(done: Expedition, tl: [string, number][], to: number): number[] {
  const times = new Set<number>(tl.map(([, t]) => t));
  const ops = done.groundOps;
  for (const r of ops?.history ?? []) for (const t of [r.startedAt, r.endedAt]) times.add(t);
  for (const l of ops?.log ?? []) times.add(l.at);
  for (const leg of ops?.shipLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.endsAt]) times.add(t);
  for (const leg of ops?.repairLegs ?? []) for (const t of [leg.startsAt, leg.arrivesAt, leg.repairedAt, leg.endsAt]) times.add(t);
  return [...times].filter((t) => Number.isFinite(t) && t > T0 + 1 && t + 1 < to).sort((a, b) => a - b);
}

// one call == 997 s chunks == 1 s steps over the 600 s around arrival and around the return == the event chain.
function expectParity(exp: Expedition): void {
  const frozen = structuredClone(exp);
  const tl = timeline(exp);
  const end = anchorOf(tl, "complete") + 1;
  const one = advanceExpedition(exp, end);
  expect(chunked(exp, exp.phaseAnchorSeconds, end, 997)).toEqual(one);
  for (const at of [anchorOf(tl, "scanning"), anchorOf(tl, "complete")]) {
    const from = Math.floor(at) - 300;
    expect(chunked(advanceExpedition(exp, from), from, from + 600, 1)).toEqual(advanceExpedition(exp, from + 600));
  }
  let e = exp;
  for (const t of eventTimes(one, tl, end)) for (const at of [t - 1, t, t + 1]) e = advanceExpedition(e, at);
  expect(advanceExpedition(e, end)).toEqual(one);
  expect(exp).toEqual(frozen);
}

describe("G2-3 the transit table: tiers set the time (user G5, G21)", () => {
  it("at the tier's minimum class and the band's middle, each tier flies its nominal hours one way", () => {
    expect(TIER_TRANSIT_HOURS).toEqual({ 1: 2, 2: 4, 3: 8, 4: 12, 5: 24, 6: 72, 7: 168 });
    for (const tier of REGION_TIERS) {
      const v = planVoyage({ tier, distanceLy: 200, band: BAND, driveClass: tier, stats: speedSheet(1), training: false });
      expect(v.outboundSeconds, `tier ${tier}`).toBe(TIER_TRANSIT_HOURS[tier] * 3600);
      expect(v.returnSeconds).toBe(v.outboundSeconds);
      expect(v.anomalySeconds).toBe(Math.round((v.outboundSeconds * VOYAGE_ANOMALY_DETOUR_PERMILLE) / 1000));
      expect(v).toMatchObject({ version: 1, tier, distanceLy: 200, driveClass: tier, outboundSpeed: 1, returnSpeed: 1 });
    }
  });

  it("each drive class above the tier's minimum halves the leg; a class at or below it changes nothing", () => {
    for (const tier of REGION_TIERS) {
      for (let cls = 1; cls <= 7; cls++) {
        const steps = Math.max(0, cls - tier);
        expect(voyageClassSteps(tier, cls)).toBe(steps);
        const v = planVoyage({ tier, distanceLy: 200, band: BAND, driveClass: cls, stats: speedSheet(1), training: false });
        expect(v.outboundSeconds, `tier ${tier} class ${cls}`).toBe(Math.max(VOYAGE_FLOOR_SECONDS, Math.round(tierNominalSeconds(tier) / 2 ** steps)));
      }
    }
    // Tier VII's week at Class VII, and the floor: Tier I at a Class VII drive would be 112 s, floored at 30 minutes.
    expect(planVoyage({ tier: 7, distanceLy: 200, band: BAND, driveClass: 7, stats: speedSheet(1), training: false }).outboundSeconds).toBe(168 * 3600);
    expect(planVoyage({ tier: 1, distanceLy: 200, band: BAND, driveClass: 7, stats: speedSheet(1), training: false }).outboundSeconds).toBe(VOYAGE_FLOOR_SECONDS);
    expect(VOYAGE_FLOOR_SECONDS).toBe(1800);
    // A fast ship is floored too: Tier I at x5 speed is 1,440 s, read as 1,800.
    expect(voyageLegSeconds(7200, 1000, 0, 5)).toBe(1800);
  });

  it("the band scale: the near edge flies x0.8, the far edge x1.2, linear between, clamped to the band", () => {
    expect(VOYAGE_BAND_SCALE_PERMILLE).toEqual({ near: 800, far: 1200 });
    expect(voyageBandScalePermille(100, BAND)).toBe(800);
    expect(voyageBandScalePermille(300, BAND)).toBe(1200);
    expect(voyageBandScalePermille(200, BAND)).toBe(1000);
    expect(voyageBandScalePermille(150, BAND)).toBe(900);
    expect(voyageBandScalePermille(50, BAND)).toBe(800);
    expect(voyageBandScalePermille(9_000, BAND)).toBe(1200);
    expect(voyageBandScalePermille(Number.NaN, BAND)).toBe(1000);
    expect(voyageBandScalePermille(120, { near: 120, far: 120 })).toBe(1000);
    // A nearer system in the same band is a shorter trip (mockup answer 5); the same spot one tier deeper is longer.
    const at = (tier: RegionTier, d: number) => planVoyage({ tier, distanceLy: d, band: BAND, driveClass: tier, stats: speedSheet(1), training: false }).outboundSeconds;
    expect(at(4, 120)).toBeLessThan(at(4, 280));
    for (const tier of REGION_TIERS.slice(1)) for (const d of [100, 200, 300]) expect(at(tier, d)).toBeGreaterThan(at((tier - 1) as RegionTier, d));
    // User 2026-10-20: tiers never overlap. The farthest system of a tier is never longer than the nearest of the next;
    // the farthest Tier III just meets the nearest Tier IV at 9.6 h.
    for (const tier of REGION_TIERS.slice(1)) expect(at((tier - 1) as RegionTier, 300)).toBeLessThanOrEqual(at(tier, 100));
    expect(at(3, 300)).toBe(9.6 * 3600);
    expect(at(4, 100)).toBe(9.6 * 3600);
  });

  it("the leg speed divides each leg on its own; the training run flies its own nominal (equal to Tier I's)", () => {
    const v = planVoyage({ tier: 2, distanceLy: 200, band: BAND, driveClass: 2, stats: speedSheet(1.25, 1.2, 0.8), training: false });
    expect(v.outboundSpeed).toBeCloseTo(1.5, 12);
    expect(v.returnSpeed).toBeCloseTo(1.0, 12);
    expect(v.outboundSeconds).toBe(Math.round(4 * 3600 / 1.5));
    expect(v.returnSeconds).toBe(4 * 3600);
    expect(TUTORIAL_TRANSIT_SECONDS).toBe(tierNominalSeconds(1));
    const trained = planVoyage({ tier: 1, distanceLy: 150, band: BAND, driveClass: 1, stats: speedSheet(1), training: true });
    expect(trained).toEqual(planVoyage({ tier: 1, distanceLy: 150, band: BAND, driveClass: 1, stats: speedSheet(1), training: false }));
  });

  it("a malformed stored voyage reads as none (the run flies the pre-G2-3 legs)", () => {
    const good = planVoyage({ tier: 1, distanceLy: 200, band: BAND, driveClass: 1, stats: speedSheet(1), training: false });
    expect(voyageOf({ voyage: good })).toBe(good);
    expect(voyageOf({})).toBeUndefined();
    expect(voyageOf({ voyage: null })).toBeUndefined();
    expect(voyageOf({ voyage: { ...good, outboundSeconds: 0 } })).toBeUndefined();
    expect(voyageOf({ voyage: { ...good, returnSeconds: 1.5 } })).toBeUndefined();
    expect(voyageOf({ voyage: { ...good, anomalySeconds: -1 } })).toBeUndefined();
    const exp = dispatch(crewed(), 1);
    const broken = { ...exp, voyage: { ...exp.voyage!, outboundSeconds: -5 } } as Expedition;
    expect(leaves(broken, "transit") - T0).toBe(TRANSIT_SECONDS + (advanceExpedition(broken, FINAL).anomalyCharted ? 3600 : 0));
  });
});

describe("G2-3 a dispatch stamps its voyage and the run flies it", () => {
  for (const tier of [1, 4, 7] as const) {
    it(`Tier ${tier}: the stamp is the candidate's voyage; outbound, the anomaly roll, the detour and the return leg read it`, () => {
      const state = crewed(goodSeed());
      const cand = candidateSystemById(state, `cand-${tier}-0`)!;
      const exp = dispatch(state, tier);
      const ship = state.ships[0];
      const band = stateHomeworld(state).regionBandsLy[tier];
      expect(exp.voyage).toEqual(planVoyage({ tier, distanceLy: cand.distanceLy, band, driveClass: STANDARD_DRIVE_CLASS, stats: effectiveShipStats(state, ship), training: false }));
      expect(exp.voyage).toEqual(candidateVoyage(state, ship, cand, false));
      expect(exp.voyage!.distanceLy).toBe(exp.region!.distanceLy);
      expect(exp.voyage!.driveClass).toBe(1);
      const v = exp.voyage!;
      // The anomaly resolves exactly at half the outbound leg (not before).
      expect(advanceExpedition(exp, T0 + v.outboundSeconds * ANOMALY_CHECK_FRACTION - 1).anomalyResolved).toBe(false);
      expect(advanceExpedition(exp, T0 + v.outboundSeconds * ANOMALY_CHECK_FRACTION).anomalyResolved).toBe(true);
      const charted = advanceExpedition(exp, T0 + v.outboundSeconds).anomalyCharted;
      const tl = timeline(exp);
      expect(anchorOf(tl, "scanning") - T0).toBe(v.outboundSeconds + (charted ? v.anomalySeconds : 0));
      expect(anchorOf(tl, "complete") - anchorOf(tl, "return")).toBe(v.returnSeconds);
      expect(returnDurationSeconds(exp)).toBe(v.returnSeconds);
    });
  }

  it("deeper tiers fly longer at the same ship: Tier I about 2 h, Tier IV about 12 h, Tier VII about a week", () => {
    const state = crewed();
    const hours = ([1, 4, 7] as const).map((t) => dispatch(state, t).voyage!.outboundSeconds / 3600);
    const speed = effectiveShipStats(state, state.ships[0]).transitSpeedMult;
    [2, 12, 168].forEach((nominal, i) => {
      expect(hours[i]).toBeGreaterThanOrEqual((nominal * 0.8) / speed - 1e-3);
      expect(hours[i]).toBeLessThanOrEqual((nominal * 1.2) / speed + 1e-3);
    });
  });

  it("the Flight Deck ramp divides a voyage run's return leg by 1 + the ramp on its hours out", () => {
    const exp = dispatch(crewed(goodSeed()), 4);
    const ramped = { ...exp, rampReturn: 0.18 } as Expedition;
    const tl = timeline(ramped);
    const hoursOut = (anchorOf(tl, "return") - T0) / 3600;
    const returning = advanceExpedition(ramped, anchorOf(tl, "return"));
    expect(returning.phase).toBe("return");
    const leg = exp.voyage!.returnSeconds / (1 + constitutionRamp(0.18, hoursOut));
    expect(returnDurationSeconds(returning)).toBeCloseTo(leg, 9);
    expect(returnDurationSeconds(returning)).toBeLessThan(exp.voyage!.returnSeconds);
    expect(anchorOf(tl, "complete") - anchorOf(tl, "return")).toBeCloseTo(leg, 6);
  });

  it("each leg flies at the ship's own speed on it: Fast Departure out, Fast Return back, the Pilot both (CP-2 OC-E5)", () => {
    const plain = dispatchRun(wiringBase()).voyage!;
    const out = dispatchRun(withBuckets(wiringBase(), [bucketOf("flightDeck", "flight.transitOut")])).voyage!;
    const back = dispatchRun(withBuckets(wiringBase(), [bucketOf("flightDeck", "flight.transitBack")])).voyage!;
    const pilot = dispatchRun(seatOfficer(wiringBase(), "pilot", ["pilot.transitCut"])).voyage!;
    expect(out.outboundSpeed).toBeGreaterThan(plain.outboundSpeed);
    expect(out.outboundSeconds).toBeLessThan(plain.outboundSeconds);
    expect(out.returnSpeed).toBe(plain.returnSpeed);
    expect(out.returnSeconds).toBe(plain.returnSeconds);
    expect(back.outboundSeconds).toBe(plain.outboundSeconds);
    expect(back.returnSpeed).toBeGreaterThan(plain.returnSpeed);
    expect(back.returnSeconds).toBeLessThan(plain.returnSeconds);
    expect(pilot.outboundSeconds).toBeLessThan(plain.outboundSeconds);
    expect(pilot.returnSeconds).toBeLessThan(plain.returnSeconds);
  });

  it("the training run's voyage is the one an ordinary run of the same ship to the same system flies", () => {
    const orion = (s: GameState): GameState => ({ ...s, ships: s.ships.map((x) => ({ ...x, typeKey: "orion" as const })) });
    const fresh = { ...crewed(), runCounts: undefined, nextExpeditionId: 1 } as GameState;
    const training = dispatch(orion(fresh), 1);
    expect(training.difficulty?.firstRun).toBe(true);
    const ordinary = dispatch(orion({ ...crewed(), nextExpeditionId: 1 }), 1); // the same list (no Wolf 359 guarantee yet)
    expect(ordinary.difficulty).toBeUndefined();
    expect(training.voyage).toEqual(ordinary.voyage);
  });
});

// A run of `tier` on expedition seed k that charts the anomaly, and one whose ship goes down for a field repair (it
// leaves one hull point under the field repair threshold: the complementGoldens pattern), both with the Flight Deck
// ramp on the return. Searched over seeds; each search is asserted to find one.
function findRun(tier: RegionTier, want: (done: Expedition) => boolean, preDamage: boolean): Expedition {
  for (let k = 0; k < 60; k++) {
    let exp = dispatch(crewed(0x13579bd + k * 7919), tier);
    if (preDamage) exp = { ...exp, groundOps: { ...exp.groundOps!, hullDamage: FIELD_REPAIR_DAMAGE_SHARE * exp.groundOps!.shipEventProfile.battle!.hullMax - 1 } };
    exp = { ...exp, rampReturn: 0.18 } as Expedition;
    const done = advanceExpedition(exp, FINAL);
    if (done.phase === "complete" && want(done)) return exp;
  }
  throw new Error(`no Tier ${tier} run found`);
}

describe("G2-3 offline == live on voyage runs (Ground Ops, the anomaly, a field repair, the Flight Deck ramp)", () => {
  for (const tier of [1, 4, 7] as const) {
    it(`Tier ${tier}: a charted anomaly`, { timeout: 60_000 }, () => {
      const exp = findRun(tier, (d) => d.anomalyCharted, false);
      expect(exp.voyage!.tier).toBe(tier);
      expectParity(exp);
    });
    it(`Tier ${tier}: a field repair`, { timeout: 60_000 }, () => {
      const exp = findRun(tier, (d) => (d.groundOps!.repairLegs ?? []).length > 0, true);
      expectParity(exp);
    });
  }
});

describe("G2-3 the speed seam acts on voyage runs (processSpeed.ts time skip)", () => {
  for (const tier of [1, 4, 7] as const) {
    it(`Tier ${tier}: the time skip finishes the run at its own natural end, each leg at its frozen length`, () => {
      const state = crewed(goodSeed());
      const exp = dispatch(state, tier);
      const held: GameState = { ...state, expeditions: [exp], gameTimeSeconds: T0 + 600 };
      const r = applyTimeSkip(held, { kind: "expedition", id: exp.id });
      expect(r.applied).toBe(true);
      const skipped = r.next.expeditions[0];
      expect(skipped.phase).toBe("complete");
      const tl = timeline(exp);
      const natural = advanceExpedition(exp, anchorOf(tl, "complete"));
      expect(skipped.phaseAnchorSeconds).toBe(anchorOf(tl, "complete"));
      const { speed, ...rest } = skipped;
      expect(rest).toEqual(natural);
      expect(speed).toEqual({ instantComplete: true, clockOffsetSeconds: anchorOf(tl, "complete") - (T0 + 600) });
    });
  }
});
