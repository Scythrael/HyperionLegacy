// telescopeCardDisplay.ts: the display decisions of the SUBSPACE TELESCOPE Facilities card (0.14.0, Squads SQ-7
// section 7.4; docs/plans/2026-10-12-squads-and-subspace-telescope-design.md section 6). The card shows the
// telescope's level, range in light-years and detail, the next development cycle's credits / time / FA gate (the
// Upgrade button itself is App.svelte's shared facilityUpgradeButton on canBuildFacilityUpgrade), the ladder of
// every level, and a galaxy map centered on the homeworld: the seven regions badged I to VII, the current range
// ring solid and the next level's ring dashed.
//
// WHY a .ts beside the card: this repo has no Svelte component test harness, so the words and the map geometry
// live here as pure functions of the facility level and the component only draws them. Every number is read from
// the engine (telescope.ts telescopeReadingAtLevel, FACILITIES.subspaceTelescope), never restated.
//
// Color is never the only signal: the current ring is solid and the next is dashed, a reached badge is drawn solid
// and an unreached one dashed, and the legend and the region key say the same thing in words. The SVG's accessible
// name (`ariaLabel`) summarizes the level, the reach and the next reach.
//
// ⚠️ PROVISIONAL HOMEWORLD (G2 not built): light-years and the badge positions are measured from telescope.ts
// PROVISIONAL_HOMEWORLD (near the Sun's position). Every reader here takes the homeworld as a parameter, so G2's
// per-player placement swaps in without touching the card.
//
// DISPLAY ONLY. Nothing here changes a rule.

import { FACILITIES, SUBSPACE_TELESCOPE_FACILITY_KEY, type GameState, type RegionTier } from "./game/model";
import {
  PROVISIONAL_HOMEWORLD,
  REGION_TIER_NAMES,
  TELESCOPE_DEVELOPMENT_CYCLES,
  TELESCOPE_LORE,
  regionTierNumeral,
  telescopeLevel,
  telescopeReadingAtLevel,
  type HomeworldPlacement,
  type TelescopeDetail,
} from "./game/telescope";

const TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

const ly = (n: number): string => `${n.toLocaleString("en-US")} ly`;
const lyLong = (n: number): string => `${n.toLocaleString("en-US")} light-years`;

function upgrades() {
  return FACILITIES[SUBSPACE_TELESCOPE_FACILITY_KEY]?.upgrades ?? [];
}

// "Tier I" / "Tiers I to IV" (0 = reads nothing, never on a real save).
function reachTierText(reachTier: number): string {
  if (reachTier <= 0) return "No region";
  if (reachTier === 1) return "Tier I";
  return `Tiers I to ${regionTierNumeral(reachTier as RegionTier)}`;
}

// "Local Bubble" / "Local Bubble to the Sagittarius Arm".
function reachNamesText(reachTier: number): string {
  if (reachTier <= 0) return "Nothing yet";
  if (reachTier === 1) return REGION_TIER_NAMES[1];
  return `${REGION_TIER_NAMES[1]} to the ${REGION_TIER_NAMES[reachTier as RegionTier]}`;
}

// The region(s) a level's range ends on: every reached region whose far edge IS the range ("Orion Arm", or
// "Perseus Arm and Sagittarius Arm" where one rung reaches both, design 6.2).
function farRegionsText(reachTier: number, rangeLy: number, homeworld: HomeworldPlacement): string {
  const names = TIERS.filter((t) => t <= reachTier && homeworld.regionBandsLy[t].far === rangeLy).map((t) => REGION_TIER_NAMES[t]);
  return names.join(" and ");
}

// ===== The card =====

export type TelescopeLadderStatus = "reached" | "current" | "building" | "next" | "later";
const LADDER_STATUS_TEXT: Readonly<Record<TelescopeLadderStatus, string>> = {
  reached: "Reached",
  current: "Current",
  building: "In progress",
  next: "Next",
  later: "",
};

export interface TelescopeLadderRow {
  level: number;
  rangeText: string; // "3,000 ly"
  reachText: string; // "Orion Arm" / "Perseus Arm and Sagittarius Arm"
  detailName: string; // "Per body"
  costText: string; // "Pre-granted" / "4,000 credits · 2m · Fleet Admiral level 3"
  status: TelescopeLadderStatus;
  statusText: string; // "Current", "In progress", ... ("" for a later rung)
}

export interface TelescopeNextCycle {
  level: number;
  credits: number;
  durationTicks: number;
  fleetAdminLevel: number | null;
  rangeLy: number;
  rangeText: string;
  sameRange: boolean; // a detail-only rung (the range does not grow)
  detailName: string;
  detailUp: boolean;
  gainLine: string; // "Development cycle 2 extends the survey to the Orion Arm." (telescope.ts, derived)
}

export interface TelescopeCardView {
  level: number;
  maxLevel: number;
  maxed: boolean;
  building: boolean; // a development cycle is in progress
  subtitle: string; // "Level 1 of 8 · Graded detail"
  rangeText: string;
  reachText: string; // "Tiers I to II"
  reachNames: string; // "Local Bubble to the Orion Arm"
  detail: TelescopeDetail;
  detailText: string; // "2 · Graded"
  lore: string;
  next: TelescopeNextCycle | null;
  ladder: TelescopeLadderRow[];
}

export interface TelescopeCardOptions {
  // How a duration in ticks reads (App.svelte passes its durationReadout, so the card honors the tick-count
  // preference like every facility card). Default: "120 ticks".
  duration?: (ticks: number) => string;
  homeworld?: HomeworldPlacement;
}

export function telescopeUpgradeInProgress(state: Pick<GameState, "activeProcesses">): boolean {
  return state.activeProcesses.some(
    (p) => p.kind === "facilityUpgrade" && p.effect.type === "facilityLevelUp" && p.effect.facility === SUBSPACE_TELESCOPE_FACILITY_KEY,
  );
}

export function telescopeCardView(state: GameState, options: TelescopeCardOptions = {}): TelescopeCardView {
  const duration = options.duration ?? ((t: number) => `${t.toLocaleString("en-US")} ticks`);
  const homeworld = options.homeworld ?? PROVISIONAL_HOMEWORLD;
  const track = upgrades();
  const maxLevel = track.length;
  const level = telescopeLevel(state);
  const reading = telescopeReadingAtLevel(level, homeworld);
  const building = telescopeUpgradeInProgress(state);
  const maxed = level >= maxLevel;

  let next: TelescopeNextCycle | null = null;
  if (!maxed) {
    const rung = track[level];
    const after = telescopeReadingAtLevel(level + 1, homeworld);
    next = {
      level: level + 1,
      credits: rung.credits?.toNumber() ?? 0,
      durationTicks: rung.durationTicks,
      fleetAdminLevel: rung.requiresFleetAdminLevel ?? null,
      rangeLy: after.rangeLy,
      rangeText: ly(after.rangeLy),
      sameRange: after.rangeLy === reading.rangeLy,
      detailName: after.detailName,
      detailUp: after.detail > reading.detail,
      gainLine: TELESCOPE_DEVELOPMENT_CYCLES[level + 1] ?? "",
    };
  }

  const ladder: TelescopeLadderRow[] = track.map((rung, i) => {
    const rowLevel = i + 1;
    const r = telescopeReadingAtLevel(rowLevel, homeworld);
    const credits = rung.credits?.toNumber() ?? 0;
    const costText =
      credits <= 0 && rung.durationTicks <= 0
        ? "Pre-granted"
        : [
            `${credits.toLocaleString("en-US")} credits`,
            duration(rung.durationTicks),
            ...(rung.requiresFleetAdminLevel !== undefined ? [`Fleet Admiral level ${rung.requiresFleetAdminLevel}`] : []),
          ].join(" · ");
    const status: TelescopeLadderStatus =
      rowLevel < level ? "reached" : rowLevel === level ? "current" : rowLevel === level + 1 ? (building ? "building" : "next") : "later";
    return {
      level: rowLevel,
      rangeText: ly(r.rangeLy),
      reachText: farRegionsText(r.reachTier, r.rangeLy, homeworld),
      detailName: r.detailName,
      costText,
      status,
      statusText: LADDER_STATUS_TEXT[status],
    };
  });

  return {
    level,
    maxLevel,
    maxed,
    building,
    subtitle: `Level ${level} of ${maxLevel} · ${reading.detailName} detail`,
    rangeText: ly(reading.rangeLy),
    reachText: reachTierText(reading.reachTier),
    reachNames: reachNamesText(reading.reachTier),
    detail: reading.detail,
    detailText: `${reading.detail} · ${reading.detailName}`,
    lore: TELESCOPE_LORE,
    next,
    ladder,
  };
}

// ===== The galaxy map =====
//
// Galactic coordinates in light-years, the Galactic Core at the origin and the homeworld at (0, its distance from
// the core). The map is CENTERED ON THE HOMEWORLD with a square-root radial scale (r_px = R * sqrt(d / DMAX)), so
// the 150 ly Local Bubble ring and the 26,500 ly ring to the core both stay readable (the approved mockup's scale).

export const TELESCOPE_MAP_RADIUS = 168;
const MAP_DMAX = 76_000;
const CX = 200;
const CY = 200;
const VIEW_BOX = "40 20 320 284";
// The room the view box leaves around the homeworld (the tightest side: 104 px below it), less a 2 px margin for the
// ring's stroke. The top ring must fit inside it; a homeworld whose farthest range would not fit scales the whole
// map down instead of clipping (telescopeMapView, the G2 guard).
const FIT_RADIUS = 102;
// A region badge's radius (TelescopeMap.svelte draws it; the overlap test reads it).
const BADGE_R = 10;
const DISK_LY = 50_000;
const BULGE_LY = 6_000;

// Where each region's badge sits, in galactic coordinates (the mockup's placements: on its arm, inside its band
// of distances from the homeworld; a test pins every badge inside its band and a test keeps badges, dots and labels
// from overlapping). Two badges sit BESIDE their spot instead of on it: the Local Bubble is too small to draw, so
// its badge touches the Level 1 ring (BUBBLE_BADGE_DIRECTION), and the Core's badge sits just off the core dot
// (CORE_BADGE_OFFSET) so the dot and the "Galactic Core" label stay visible.
// ⚠️ G2: these are hand-placed for PROVISIONAL_HOMEWORLD. With per-player homeworlds the badge spots must become
// band-relative (placed inside each region's band as measured from that homeworld) and the overlap and ring-fit
// tests re-run per placement.
const BADGE_POSITIONS: Readonly<Record<RegionTier, { x: number; dy: number }>> = {
  // dy is relative to the homeworld's galactic y (positive = outward, away from the core).
  1: { x: 60, dy: 90 }, // distance only (the pixel spot is BUBBLE_BADGE_DIRECTION)
  2: { x: -1_700, dy: -50 },
  3: { x: 1_300, dy: 5_850 },
  4: { x: -900, dy: -5_450 },
  5: { x: 3_600, dy: -10_800 },
  6: { x: -5_600, dy: -21_300 },
  7: { x: 0, dy: 0 }, // unused: the Core badge is placed off the Galactic Core (galactic origin, below)
};
const BUBBLE_BADGE_DIRECTION = { x: 0.75, y: 0.66 };
const CORE_BADGE_OFFSET = { x: 17, y: 3 };

export interface TelescopeMapBadge {
  tier: RegionTier;
  numeral: string;
  name: string;
  x: number;
  y: number;
  distanceLy: number; // from the homeworld
  reached: boolean;
  label: string; // "III Perseus Arm, beyond range"
}

export interface TelescopeMapLabel {
  x: number;
  y: number; // the baseline
  text: string;
  size: number; // px
  anchor: "start" | "middle" | "end";
}

export interface TelescopeMapView {
  viewBox: string;
  home: { x: number; y: number };
  core: { x: number; y: number };
  diskPath: string;
  armPaths: string[]; // the three major arms, then the minor Orion spur
  bulgePath: string;
  ringR: number;
  nextRingR: number | null; // null at the top, and on a detail-only rung (the range does not grow)
  badges: TelescopeMapBadge[];
  badgeR: number;
  homeLabel: TelescopeMapLabel;
  coreLabel: TelescopeMapLabel;
  ariaLabel: string;
  legend: string[];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// The farthest range any level reaches from this homeworld (the top rung's ring).
function rangeLyForReachTop(homeworld: HomeworldPlacement): number {
  return Math.max(...TIERS.map((t) => homeworld.regionBandsLy[t].far));
}

export function telescopeMapView(level: number, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): TelescopeMapView {
  const homeY = homeworld.distanceFromCoreLy;
  // The radial scale: the mockup's TELESCOPE_MAP_RADIUS, shrunk only when this homeworld's farthest range would not
  // fit the view box (never clip a ring).
  const farthestLy = rangeLyForReachTop(homeworld);
  const radius = Math.min(TELESCOPE_MAP_RADIUS, FIT_RADIUS * Math.sqrt(MAP_DMAX / Math.max(1, farthestLy)));

  // Galactic (x, y) -> map pixels, centered on the homeworld.
  const proj = (x: number, y: number): [number, number] => {
    const dx = x;
    const dy = y - homeY;
    const d = Math.hypot(dx, dy);
    if (d < 1) return [CX, CY];
    const r = radius * Math.sqrt(d / MAP_DMAX);
    return [CX + (dx / d) * r, CY + (dy / d) * r];
  };
  const ringR = (rangeLy: number): number => round1(Math.max(4, radius * Math.sqrt(rangeLy / MAP_DMAX)));
  const pathOf = (pts: [number, number][], close = false): string =>
    pts
      .map((p, i) => {
        const q = proj(p[0], p[1]);
        return `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
      })
      .join("") + (close ? "Z" : "");
  // A logarithmic spiral arm (pitch k), sampled over [-span, span] radians, clipped to the disk.
  const arm = (r0: number, span: number, steps: number): [number, number][] => {
    const k = 0.2126;
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = -span + (2 * span * i) / steps;
      const r = r0 * Math.exp(k * t);
      if (r > DISK_LY) continue;
      const th = Math.PI / 2 + t;
      pts.push([r * Math.cos(th), r * Math.sin(th)]);
    }
    return pts;
  };
  const circle = (r: number, n: number): [number, number][] => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  };

  const now = telescopeReadingAtLevel(level, homeworld);
  const maxLevel = upgrades().length;
  const hasNext = now.level < maxLevel;
  const after = hasNext ? telescopeReadingAtLevel(now.level + 1, homeworld) : null;
  const rangeGrows = after !== null && after.rangeLy > now.rangeLy;

  const [coreX, coreY] = proj(0, 0);
  const badges: TelescopeMapBadge[] = TIERS.map((tier) => {
    const pos = BADGE_POSITIONS[tier];
    const gx = pos.x;
    const gy = tier === 7 ? 0 : homeY + pos.dy;
    let [x, y] = proj(gx, gy);
    if (tier === 1) {
      // Touching the Level 1 ring from outside, so "in range" reads true on the map.
      const touch = ringR(telescopeReadingAtLevel(1, homeworld).rangeLy) + BADGE_R;
      const n = Math.hypot(BUBBLE_BADGE_DIRECTION.x, BUBBLE_BADGE_DIRECTION.y);
      [x, y] = [CX + (BUBBLE_BADGE_DIRECTION.x / n) * touch, CY + (BUBBLE_BADGE_DIRECTION.y / n) * touch];
    }
    if (tier === 7) [x, y] = [coreX + CORE_BADGE_OFFSET.x, coreY + CORE_BADGE_OFFSET.y];
    const reached = tier <= now.reachTier;
    const numeral = regionTierNumeral(tier);
    const name = REGION_TIER_NAMES[tier];
    return {
      tier,
      numeral,
      name,
      x: round1(x),
      y: round1(y),
      distanceLy: Math.round(Math.hypot(gx, gy - homeY)),
      reached,
      label: `${numeral} ${name}, ${reached ? "in range" : "beyond range"}`,
    };
  });

  let nextSentence: string;
  let nextLegend: string;
  if (after === null) {
    nextSentence = "Fully upgraded: every region is in range.";
    nextLegend = nextSentence;
  } else if (!rangeGrows) {
    nextSentence = `Level ${after.level} adds detail, not range.`;
    nextLegend = nextSentence;
  } else {
    nextSentence = `Level ${after.level} would reach ${lyLong(after.rangeLy)}, ${reachTierText(after.reachTier)}.`;
    nextLegend = `Dashed ring: Level ${after.level}, ${ly(after.rangeLy)}.`;
  }

  return {
    viewBox: VIEW_BOX,
    home: { x: CX, y: CY },
    core: { x: round1(coreX), y: round1(coreY) },
    diskPath: pathOf(circle(DISK_LY, 120), true),
    armPaths: [pathOf(arm(32_400, 2.6, 80)), pathOf(arm(21_000, 2.6, 80)), pathOf(arm(16_000, 2.8, 80)), pathOf(arm(homeY, 0.35, 20))],
    bulgePath: pathOf(circle(BULGE_LY, 60), true),
    ringR: ringR(now.rangeLy),
    nextRingR: rangeGrows && after ? ringR(after.rangeLy) : null,
    badgeR: BADGE_R,
    homeLabel: { x: CX + 8, y: CY - 8, text: "Homeworld", size: 10, anchor: "start" },
    coreLabel: { x: round1(coreX), y: round1(coreY - 11), text: "Galactic Core", size: 9, anchor: "middle" },
    badges,
    ariaLabel: `Galaxy map centered on your homeworld. Subspace Telescope Level ${now.level} reaches ${lyLong(now.rangeLy)}, ${reachTierText(now.reachTier)}. ${nextSentence}`,
    legend: [`Solid ring: your range now, ${ly(now.rangeLy)}.`, nextLegend],
  };
}
