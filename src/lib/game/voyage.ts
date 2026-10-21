// Expedition Tiers G2-3 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-3): THE VOYAGE ENGINE. Pure.
//
// How long an expedition flies out and back, frozen on the run at dispatch (Expedition.voyage, model.ts
// ExpeditionVoyage). User decisions (verbatim records in the plan's USER ANSWERS, 2026-10-16):
//   - G5 "2h to 168h ladder (Recommended)": one way at the tier's minimum drive class I 2 h, II 4 h, III 8 h, IV 12 h,
//     V 24 h, VI 72 h, VII 168 h; halved per drive class above the minimum; 30 minute floor.
//   - G21 + G14 "Tiers set the time (Recommended)": tiers are difficulty; distance shifts time only within a tier
//     (so a Tier IV trip is longer than a Tier III one though the Sagittarius Arm sits nearer); detour time is not
//     distance flown on recall (G2-5 reads `outboundSeconds`, never the detour).
//   - mockup answer 5: "the nearest options within that region": a nearer system in the band is a shorter trip.
//   - CP-2 OC-E5 (user 2026-10-15 "Each its own leg"): each leg flies at the ship's own speed on that leg
//     (model.ts outboundLegSpeed / returnLegSpeed): the sweeping transitSpeedMult (hull, drive, gear, the Pilot's
//     transit cut on officer.transitTimeCut, the museum, Inspiring Leader) times that leg's complement lift (Fast
//     Departure out, Fast Return back).
//
// One leg = round(nominal x bandScale / 2^(classes above the tier's minimum) / leg speed), floored at
// VOYAGE_FLOOR_SECONDS. Why not plain distance over speed: the bands run 150 to 26,500 ly (x177) while the wanted
// times run 2 h to a week (x84), and Tier IV sits nearer than Tier III; the light-years drive the reach gate (G2-4)
// and the within-band scale, the tier drives the hours.
//
// THE SPEED SEAM (processSpeed.ts): an expedition is a pure function of its stored record and elapsed time, so the
// tutorial time skip finishes a voyage run by running its own clock (each leg at its frozen length). Overtime (the
// credit-paid speed-up, credit sinks USER ANSWERS) covers gear repair, Shipyard repairs and builds, research and
// facility upgrades; expeditions are excluded by user ruling 2026-10-20 ("No, not expeditions"): a voyage keeps its
// frozen legs.
//
// Module graph: model (types + the leg speed readers), galaxy (types). Imported by expedition.ts.

import { outboundLegSpeed, returnLegSpeed, type ExpeditionVoyage, type RegionTier, type ShipDerivedStats } from "./model";
import type { RegionBandLy } from "./galaxy";

// (user G5) The nominal one-way hours at the tier's minimum drive class.
export const TIER_TRANSIT_HOURS: Readonly<Record<RegionTier, number>> = { 1: 2, 2: 4, 3: 8, 4: 12, 5: 24, 6: 72, 7: 168 };
// (user G5) No leg is shorter than 30 minutes.
export const VOYAGE_FLOOR_SECONDS = 1_800;
// Where a system sits in its tier's band scales the time (user G21: "distance shifts time only within a tier"): the
// band's near edge flies x0.8 of the nominal, its far edge x1.2, linear between, in whole per-mille. User 2026-10-20
// "x0.8 to x1.2": tiers never overlap; the farthest Tier III (8 h x1.2) just meets the nearest Tier IV (12 h x0.8)
// at 9.6 h.
export const VOYAGE_BAND_SCALE_PERMILLE: Readonly<{ near: number; far: number }> = { near: 800, far: 1_200 };
// The charted anomaly's detour: 25% of the outbound leg (user 2026-10-20 "25% of outbound"; the pre-G2-3 detour was a
// flat hour on a 6 hour leg). Not distance flown (user G14).
export const VOYAGE_ANOMALY_DETOUR_PERMILLE = 250;
// Every ship's drive class until G2-4 (drive classes on FTL drives and hulls, user G3) gives drives a class: Class I.
export const STANDARD_DRIVE_CLASS = 1;
// Safe first runs SF-2 (user, group 3): the TRAINING RUN's nominal one-way time (runDifficulty.ts
// isTrainingExpedition: the first expedition from an explorer). Its own constant, set EQUAL to the Tier I nominal for
// now (the training run is a Tier I run, so it flies exactly what that system would): the tutorial patch shortens it
// (about 5 seconds, the story beats carrying the trip). The floor never lengthens it past itself.
export const TUTORIAL_TRANSIT_SECONDS = TIER_TRANSIT_HOURS[1] * 3_600;

// The minimum drive class a tier asks for (G2-4's tier gate: the installed drive's class >= the region tier). Pure.
export function tierMinimumDriveClass(tier: RegionTier): number {
  return tier;
}

// The nominal one-way seconds of `tier` at its minimum drive class. Pure.
export function tierNominalSeconds(tier: RegionTier): number {
  return (TIER_TRANSIT_HOURS[tier] ?? TIER_TRANSIT_HOURS[1]) * 3_600;
}

// The band scale (whole per-mille) of a system `distanceLy` from the homeworld in `band`: near edge 800, far edge
// 1,200, clamped to the band (a famous star clamped into it, or a malformed number, reads its edge). A degenerate
// band reads its middle. Pure.
export function voyageBandScalePermille(distanceLy: number, band: RegionBandLy): number {
  const { near, far } = VOYAGE_BAND_SCALE_PERMILLE;
  const width = band.far - band.near;
  if (!(width > 0) || !Number.isFinite(distanceLy)) return Math.round((near + far) / 2);
  const at = Math.max(0, Math.min(1, (distanceLy - band.near) / width));
  return near + Math.round((far - near) * at);
}

// How many times a leg halves: the drive classes above the tier's minimum (never negative: G2-4 refuses a drive
// below it). Pure.
export function voyageClassSteps(tier: RegionTier, driveClass: number): number {
  const steps = Math.floor(driveClass) - tierMinimumDriveClass(tier);
  return Number.isFinite(steps) && steps > 0 ? steps : 0;
}

// One leg's whole seconds: the nominal x the band scale, halved per class step, divided by the leg speed, floored.
// A non-positive or non-finite speed reads 1 (defensive). Pure.
export function voyageLegSeconds(nominalSeconds: number, scalePermille: number, classSteps: number, speed: number): number {
  const s = speed > 0 && Number.isFinite(speed) ? speed : 1;
  const raw = (nominalSeconds * scalePermille) / 1_000 / 2 ** classSteps / s;
  return Math.max(Math.min(VOYAGE_FLOOR_SECONDS, nominalSeconds), Math.round(raw));
}

// The voyage a dispatch freezes: to a system of `tier` `distanceLy` from the homeworld (its tier's `band` measured
// from there), on a ship whose stat sheet is `stats` with drive class `driveClass`; `training` = the training run
// (its own nominal, TUTORIAL_TRANSIT_SECONDS). Pure: a fresh object.
export function planVoyage(input: {
  tier: RegionTier;
  distanceLy: number;
  band: RegionBandLy;
  driveClass: number;
  stats: ShipDerivedStats;
  training: boolean;
}): ExpeditionVoyage {
  const { tier, distanceLy, band, driveClass, stats, training } = input;
  const nominal = training ? TUTORIAL_TRANSIT_SECONDS : tierNominalSeconds(tier);
  const scale = voyageBandScalePermille(distanceLy, band);
  const steps = voyageClassSteps(tier, driveClass);
  const outboundSpeed = outboundLegSpeed(stats);
  const returnSpeed = returnLegSpeed(stats);
  const outboundSeconds = voyageLegSeconds(nominal, scale, steps, outboundSpeed);
  return {
    version: 1,
    tier,
    distanceLy,
    driveClass,
    outboundSpeed,
    returnSpeed,
    outboundSeconds,
    returnSeconds: voyageLegSeconds(nominal, scale, steps, returnSpeed),
    anomalySeconds: Math.round((outboundSeconds * VOYAGE_ANOMALY_DETOUR_PERMILLE) / 1_000),
  };
}

// The stored voyage when it is well formed (the three durations whole and positive), else undefined: the run then
// flies the pre-G2-3 legs. Pure.
export function voyageOf(exp: { voyage?: unknown }): ExpeditionVoyage | undefined {
  const v = exp.voyage as Partial<ExpeditionVoyage> | undefined;
  if (typeof v !== "object" || v === null) return undefined;
  const ok = (n: unknown, min: number): boolean => typeof n === "number" && Number.isInteger(n) && n >= min;
  return ok(v.outboundSeconds, 1) && ok(v.returnSeconds, 1) && ok(v.anomalySeconds, 0) ? (v as ExpeditionVoyage) : undefined;
}
