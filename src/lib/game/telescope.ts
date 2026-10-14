// Squads SQ-5 (docs/plans/2026-10-12-squads-and-subspace-telescope-design.md section 6): the SUBSPACE TELESCOPE
// reading. Pure readers; nothing here changes a run.
//
//   THE FACILITY (model.ts FACILITIES.subspaceTelescope, SUBSPACE_TELESCOPE_LEVELS): a homeworld facility on the
//   existing upgrade framework, pre-granted at Level 1. Lore (user, 2026-10-12): every upgrade is a funded
//   DEVELOPMENT CYCLE to improve the telescope, in the hope of finding a jump gate that was not destroyed.
//   RANGE (user, 3c): which systems it can pre-survey before launch, nearer regions first. A rung is defined by
//   the REGION TIER it reaches; the light-years shown are that region's far edge measured from the player's
//   homeworld (design 6.2), so every player's Level 3 reaches the same region. Beyond range a system launches
//   BLIND (user): SQ-7's dispatch confirm warns that this is truly unknown territory (user #7).
//   DETAIL (design 6.3): 0 Blind, 1 Contact, 2 Graded, 3 Per body, 4 Recommendation, 5 Forecast, FLAT across the
//   whole range [PROVISIONAL, user #8: no falloff in the outermost region until the user answers].
//   THE SHIP'S LIFT (design 6.4, user #10 "keep, balance later"): the launching ship's crew-inclusive sensors at
//   or above TELESCOPE_SHIP_LIFT_SENSORS add one detail level, never past Forecast and never past range.
//
// DISPLAY ONLY. The reading gates what the expedition card SHOWS of expeditionRiskPreview (the same draw the run
// makes); a run's resolution never reads the telescope (telescope.test.ts proves a run is identical at every
// level). The system's distance is drawn on its own salt (SYSTEM_DISTANCE_SALT) and feeds nothing but the reading.
//
// Module graph: model (FACILITIES, types), combat/rng, riskFactors (types). Imported by expedition.ts (the
// candidate's reading) and the UI; it imports neither.

import {
  FACILITIES,
  SUBSPACE_TELESCOPE_FACILITY_KEY,
  type BodyRiskGrades,
  type ExpeditionRiskProfile,
  type GameState,
  type RegionTier,
  type RiskGrade,
} from "./model";
import { makeRng } from "./combat/rng";
import type { RiskFactorId } from "./riskFactors";

// ===== Detail levels (design 6.3; names [PROPOSAL, PROVISIONAL]) =====

export type TelescopeDetail = 0 | 1 | 2 | 3 | 4 | 5;
export const TELESCOPE_DETAIL = {
  blind: 0,
  contact: 1,
  graded: 2,
  perBody: 3,
  // SQ-6 HOOKS: at Recommendation the card adds the squad recommendation, at Forecast the threat tier of the
  // crew the plan would send. Both read `detail >= TELESCOPE_DETAIL.recommendation / .forecast` on the reading.
  recommendation: 4,
  forecast: 5,
} as const;
export const TELESCOPE_DETAIL_NAMES: readonly string[] = ["Blind", "Contact", "Graded", "Per body", "Recommendation", "Forecast"];
const MAX_DETAIL: TelescopeDetail = 5;

function toDetail(n: number): TelescopeDetail {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_DETAIL, Math.floor(n))) as TelescopeDetail;
}

// The ship's lift (design 6.4): sensors at or above this add TELESCOPE_SHIP_LIFT detail levels. The same 40 as
// expedition.ts SENSOR_REVEAL_HAZARD (a test pins them equal; this module cannot import expedition.ts).
// [PROVISIONAL, user #10: keep, balance later]
export const TELESCOPE_SHIP_LIFT_SENSORS = 40;
export const TELESCOPE_SHIP_LIFT = 1;

// ===== The regions and the homeworld =====

// The approved expedition ladder (2026-10-08 gas giant design 1c; Roman numerals in game).
export const REGION_TIER_NAMES: Readonly<Record<RegionTier, string>> = {
  1: "Local Bubble",
  2: "Orion Arm",
  3: "Perseus Arm",
  4: "Sagittarius Arm",
  5: "Scutum-Centaurus Arm",
  6: "Galactic Bulge",
  7: "Galactic Core",
};
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII"];
export function regionTierNumeral(tier: RegionTier): string {
  return NUMERALS[tier - 1] ?? String(tier);
}

// A region's band of distances from a homeworld, in light-years (a system of that region lies in [near, far]).
export interface RegionBandLy {
  near: number;
  far: number;
}
export interface HomeworldPlacement {
  id: string;
  distanceFromCoreLy: number; // the homeworld's galactic position (its distance from the Galactic Core)
  regionBandsLy: Readonly<Record<RegionTier, RegionBandLy>>;
}

// ⚠️ PROVISIONAL HOMEWORLD POSITION (one constant until G2 builds per-player placement, user 3b.6: "every
// homeworld system should be different for each player"). It sits near the Sun's position, about 26,500 ly from
// the Galactic Core, and the bands are the tiers mockup's, as measured from there: the Local Bubble out to 150 ly
// (the nearest stars sit about 4 ly out), the Orion Arm to 3,000 ly, Perseus (about 6,400 ly outward) and
// Sagittarius (about 5,000 ly inward) sharing one band to 7,600 ly (so one rung reaches both, design 6.2),
// Scutum-Centaurus to 13,000 ly, the Bulge to 25,000 ly and the Core to 26,500 ly. G2 replaces this with each
// player's own placement and its measured bands; every reader takes the homeworld as a parameter.
export const PROVISIONAL_HOMEWORLD: HomeworldPlacement = {
  id: "provisionalNearSol",
  distanceFromCoreLy: 26_500,
  regionBandsLy: {
    1: { near: 4, far: 150 },
    2: { near: 150, far: 3_000 },
    3: { near: 3_000, far: 7_600 },
    4: { near: 3_000, far: 7_600 },
    5: { near: 7_600, far: 13_000 },
    6: { near: 13_000, far: 25_000 },
    7: { near: 25_000, far: 26_500 },
  },
};

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

// The telescope's range for a reach tier: the farthest edge of every region up to it (0 reads nothing). Pure.
export function rangeLyForReach(reachTier: number, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): number {
  let range = 0;
  for (const t of TIERS) if (t <= reachTier) range = Math.max(range, homeworld.regionBandsLy[t].far);
  return range;
}

// A system's distance from the homeworld [PROVISIONAL: G2's map supplies real positions]: a whole number of
// light-years inside its region's band, drawn on its own keyed stream so it shifts no other draw. Pure.
export const SYSTEM_DISTANCE_SALT = 0x4b1d8e33;
export function systemDistanceLy(seed: number, tier: RegionTier, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): number {
  const band = homeworld.regionBandsLy[tier] ?? homeworld.regionBandsLy[1];
  const rng = makeRng((seed ^ SYSTEM_DISTANCE_SALT) >>> 0);
  return band.near + rng.nextInt(Math.max(1, band.far - band.near + 1));
}

// ===== The facility reading =====

export interface TelescopeReading {
  level: number;
  reachTier: RegionTier | 0; // 0 = reads nothing (an unfounded telescope; never on a real save)
  rangeLy: number;
  detail: TelescopeDetail;
  detailName: string;
}

// The telescope's level (absent = 0, the facility framework's posture; freshState and SAVE v68 seed 1). Pure.
export function telescopeLevel(state: GameState): number {
  return state.facilities[SUBSPACE_TELESCOPE_FACILITY_KEY]?.level ?? 0;
}

// What a telescope at `level` reads: the ABSOLUTE values of the highest reached rung carrying the telescope effect
// (a level past the track reads the top rung). Pure.
export function telescopeReadingAtLevel(level: number, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): TelescopeReading {
  const upgrades = FACILITIES[SUBSPACE_TELESCOPE_FACILITY_KEY]?.upgrades ?? [];
  let reachTier = 0;
  let detail: TelescopeDetail = 0;
  const reached = Math.min(Math.max(0, Math.floor(level) || 0), upgrades.length);
  for (let i = 0; i < reached; i++) {
    const effect = upgrades[i].effect;
    if ("telescope" in effect) {
      reachTier = Math.max(0, Math.min(7, Math.floor(effect.telescope.reachTier)));
      detail = toDetail(effect.telescope.detail);
    }
  }
  return {
    level: Math.max(0, Math.floor(level) || 0),
    reachTier: reachTier as RegionTier | 0,
    rangeLy: rangeLyForReach(reachTier, homeworld),
    detail,
    detailName: TELESCOPE_DETAIL_NAMES[detail],
  };
}

export function telescopeReading(state: GameState, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): TelescopeReading {
  return telescopeReadingAtLevel(telescopeLevel(state), homeworld);
}

// ===== Development cycles (flavor, per the user's lore) =====

// The lore line (user, 2026-10-12) for SQ-7's Facilities card and Help. No named builders, no new entity.
export const TELESCOPE_LORE =
  "Every upgrade funds a new development cycle for the Subspace Telescope, in the hope that it finds a jump gate that was not destroyed.";

// One line per bought level, saying what that funded development cycle improves. DERIVED from the ladder (never
// hand-written numbers in prose, the helpTopics rule), so a retune of SUBSPACE_TELESCOPE_LEVELS cannot make it lie.
function cycleLine(level: number): string {
  const now = telescopeReadingAtLevel(level);
  const before = telescopeReadingAtLevel(level - 1);
  const gains: string[] = [];
  if (now.reachTier > before.reachTier && now.reachTier > 0) {
    const reached = TIERS.filter((t) => t > before.reachTier && t <= now.reachTier).map((t) => `the ${REGION_TIER_NAMES[t]}`);
    gains.push(`extends the survey to ${reached.join(" and ")}`);
  }
  if (now.detail > before.detail) gains.push(`reads systems at ${now.detailName} detail`);
  return `Development cycle ${level} ${gains.length > 0 ? gains.join(" and ") : "refines the array"}.`;
}
export const TELESCOPE_DEVELOPMENT_CYCLES: Readonly<Record<number, string>> = Object.fromEntries(
  (FACILITIES[SUBSPACE_TELESCOPE_FACILITY_KEY]?.upgrades ?? []).slice(1).map((_, i) => [i + 2, cycleLine(i + 2)]),
);

// ===== Gating the risk preview by detail (design 6.3) =====

export interface TelescopeFactorReading {
  present: boolean; // Contact (1) and up: the factor is above None anywhere in the system
  grade: RiskGrade | null; // Graded (2) and up: the system-level grade (the worst body)
}
export interface TelescopeBodyReading {
  combat: RiskGrade;
  fauna: RiskGrade;
  flora: RiskGrade;
  hazard: RiskGrade;
}
export interface TelescopeRiskView {
  factors: Record<RiskFactorId, TelescopeFactorReading>;
  enemyTerritory: boolean | null; // Graded (2) and up
  bodies: TelescopeBodyReading[] | null; // Per body (3) and up, body order
  // SQ-6 HOOK: Per body's task demand line ("Security work on 3 of 5 bodies; 2 tasks need 2 Science squads"),
  // the Recommendation and the Forecast all read the TASK preview (discoveries + needs + difficulty on the
  // committed seed), which SQ-6 builds; this view carries the risk grades only.
}

const FACTORS: readonly RiskFactorId[] = ["combat", "fauna", "flora", "hazard"];

// What `detail` reveals of a system's risk preview (expeditionRiskPreview). The SYSTEM-LEVEL reading of a factor is
// the WORST body's grade, so it never shows life on a system of lifeless worlds (the profile's drawn system grade
// can, before Fauna / Flora read None on barren, volcanic and gas giant bodies). A body's hostile site placement is
// never shown here: whether it becomes a task depends on the deployed squads (SQ-6's task preview). Pure.
export function gateRiskView(
  preview: { profile: ExpeditionRiskProfile; bodies: readonly BodyRiskGrades[] },
  detail: number,
): TelescopeRiskView | null {
  const d = toDetail(detail);
  if (d < TELESCOPE_DETAIL.contact) return null;
  const graded = d >= TELESCOPE_DETAIL.graded;
  const factors = {} as Record<RiskFactorId, TelescopeFactorReading>;
  for (const f of FACTORS) {
    const worst = preview.bodies.reduce<number>((m, b) => Math.max(m, b[f]), 0) as RiskGrade;
    factors[f] = { present: worst > 0, grade: graded ? worst : null };
  }
  return {
    factors,
    enemyTerritory: graded ? preview.profile.enemyTerritory : null,
    bodies:
      d >= TELESCOPE_DETAIL.perBody
        ? preview.bodies.map((b) => ({ combat: b.combat, fauna: b.fauna, flora: b.flora, hazard: b.hazard }))
        : null,
  };
}

// ===== One candidate system, read =====

export interface SystemTelescopeReading {
  regionTier: RegionTier; // always known (design 6.3 Blind: name, region, distance)
  distanceLy: number; // from the homeworld
  rangeLy: number; // the telescope's range (the "Level 2 reads 3,000 ly; this system is 6,420 ly" gap)
  inRange: boolean;
  // Beyond range: the launch is BLIND. SQ-7's dispatch confirm reads this to warn "truly unknown territory, are you
  // sure you wish to go" (user #7); the blind-launch achievement idea would count dispatches made while it is true.
  blind: boolean;
  telescopeDetail: TelescopeDetail; // what the telescope alone reads here (0 when blind)
  shipLift: boolean; // the ship's sensors raised the detail
  detail: TelescopeDetail; // the effective detail the card shows
  detailName: string;
  risk: TelescopeRiskView | null; // the risk preview gated by `detail` (null when blind)
}

// Read one candidate system: the telescope's reading, the candidate's seed, the launching ship's crew-inclusive
// sensors and the candidate's risk preview (expeditionRiskPreview(seed)). In range by DISTANCE (which, with the
// bands above, is exactly "the region is within the reached tiers"). Pure.
export function readSystem(
  reading: TelescopeReading,
  seed: number,
  shipSensorPower: number,
  preview: { profile: ExpeditionRiskProfile; bodies: readonly BodyRiskGrades[] },
  homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD,
): SystemTelescopeReading {
  const regionTier = preview.profile.tier;
  const distanceLy = systemDistanceLy(seed, regionTier, homeworld);
  const inRange = reading.reachTier > 0 && distanceLy <= reading.rangeLy;
  const telescopeDetail: TelescopeDetail = inRange ? reading.detail : 0;
  const lifted = inRange && shipSensorPower >= TELESCOPE_SHIP_LIFT_SENSORS ? toDetail(telescopeDetail + TELESCOPE_SHIP_LIFT) : telescopeDetail;
  return {
    regionTier,
    distanceLy,
    rangeLy: reading.rangeLy,
    inRange,
    blind: !inRange,
    telescopeDetail,
    shipLift: lifted > telescopeDetail,
    detail: lifted,
    detailName: TELESCOPE_DETAIL_NAMES[lifted],
    risk: inRange ? gateRiskView(preview, lifted) : null,
  };
}
