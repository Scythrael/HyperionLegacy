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
// THE HOMEWORLD (Expedition Tiers G2-1): light-years and the badge positions are measured from the save's own
// homeworld (galaxy.ts stateHomeworld; the card reads it off the state, App.svelte passes it to the map). The map's
// default, PROVISIONAL_HOMEWORLD (Sol's position), is the fixture the badges were hand-placed for.
//
// ENEMY TERRITORY (G2-7, the approved 2026-11-09 shading mockup, user: "Hatch + dashed edge", legend "Once a sector is
// in range", "\"Enemy territory\", hide out-of-range"): telescopeMapEnemyView draws each of the homeworld's fixed
// sectors (galaxy.ts enemySectors) that the telescope reaches as a hatched slice of its region's band, and says so in
// words (a legend line, "part enemy" on the region's key row, one sentence in the map's accessible name).
//
// DISPLAY ONLY. Nothing here changes a rule.

import { FACILITIES, SUBSPACE_TELESCOPE_FACILITY_KEY, type GameState, type RegionTier } from "./game/model";
import {
  PROVISIONAL_HOMEWORLD,
  REGION_TIER_NAMES,
  TELESCOPE_DEVELOPMENT_CYCLES,
  TELESCOPE_LORE,
  regionTierNumeral,
  stateHomeworld,
  telescopeLevel,
  telescopeReadingAtLevel,
  type HomeworldPlacement,
  type TelescopeDetail,
} from "./game/telescope";
import { BEARING_TURN, SOL_GALACTIC, type EnemySector } from "./game/galaxy";
import { ENEMY_TERRITORY_COMBAT_STEP, RISK_FACTOR_NAMES } from "./game/riskFactors";

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
  homeworld?: HomeworldPlacement; // default: the save's own (galaxy.ts stateHomeworld)
}

export function telescopeUpgradeInProgress(state: Pick<GameState, "activeProcesses">): boolean {
  return state.activeProcesses.some(
    (p) => p.kind === "facilityUpgrade" && p.effect.type === "facilityLevelUp" && p.effect.facility === SUBSPACE_TELESCOPE_FACILITY_KEY,
  );
}

export function telescopeCardView(state: GameState, options: TelescopeCardOptions = {}): TelescopeCardView {
  const duration = options.duration ?? ((t: number) => `${t.toLocaleString("en-US")} ticks`);
  const homeworld = options.homeworld ?? stateHomeworld(state);
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
// Galactic coordinates in light-years, the Galactic Core at the origin, Sol at (0, 26,500) and the homeworld at its
// own position (galaxy.ts, 10 to 120 ly from Sol since G2-1). The map is CENTERED ON THE HOMEWORLD with a square-root
// radial scale (r_px = R * sqrt(d / DMAX)), so the 150 ly Local Bubble ring and the 26,500 ly ring to the core both
// stay readable (the approved mockup's scale). The galaxy itself (disk, arms, bulge, the Orion spur through Sol) is
// fixed; only the center moves.

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
// G2-1 (the SQ-7.4 carry note): BAND-RELATIVE per homeworld. These spots are hand-placed for PROVISIONAL_HOMEWORLD
// (the REFERENCE bands); for another homeworld each badge keeps its direction and its place WITHIN its band: its
// distance d is remapped from the reference band onto that homeworld's band (badgeDistanceLy), so it always sits
// inside its region's band as measured from that homeworld. telescopeCardDisplay.test.ts runs the bounds, ring-fit,
// overlap and in-band tests over 200 placements.
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

// A badge's distance from homeworld: its reference distance d moved to the same place in that homeworld's band
// (written as d plus the edge shifts, so the reference homeworld gets d back exactly).
function badgeDistanceLy(d: number, tier: RegionTier, homeworld: HomeworldPlacement): number {
  const ref = PROVISIONAL_HOMEWORLD.regionBandsLy[tier];
  const band = homeworld.regionBandsLy[tier];
  const f = (d - ref.near) / Math.max(1, ref.far - ref.near);
  return d + (band.near - ref.near) + f * (band.far - band.near - (ref.far - ref.near));
}
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

// The radial scale: the mockup's TELESCOPE_MAP_RADIUS, shrunk only when this homeworld's farthest range would not
// fit the view box (never clip a ring).
function mapRadius(homeworld: HomeworldPlacement): number {
  return Math.min(TELESCOPE_MAP_RADIUS, FIT_RADIUS * Math.sqrt(MAP_DMAX / Math.max(1, rangeLyForReachTop(homeworld))));
}

// Expedition Tiers G2-6: the map ring radius (px, from the homeworld) of a distance in light-years on the same
// square-root scale telescopeMapView draws (the dispatch console's small region map draws a ship's reach with it),
// capped at the farthest region's ring so a long reach never runs off the map. Pure.
export function telescopeMapRingRadius(homeworld: HomeworldPlacement, ly: number): number {
  const capped = Math.max(0, Math.min(ly, rangeLyForReachTop(homeworld)));
  return round1(Math.max(4, mapRadius(homeworld) * Math.sqrt(capped / MAP_DMAX)));
}

export function telescopeMapView(level: number, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): TelescopeMapView {
  const homeX = homeworld.galactic.x;
  const homeY = homeworld.galactic.y;
  const radius = mapRadius(homeworld);

  // Galactic (x, y) -> map pixels, centered on the homeworld.
  const proj = (x: number, y: number): [number, number] => {
    const dx = x - homeX;
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
    const ref = Math.hypot(pos.x, pos.dy);
    const scale = tier === 7 || ref < 1 ? 1 : badgeDistanceLy(ref, tier, homeworld) / ref;
    const gx = tier === 7 ? 0 : homeX + pos.x * scale;
    const gy = tier === 7 ? 0 : homeY + pos.dy * scale;
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
      distanceLy: Math.round(Math.hypot(gx - homeX, gy - homeY)),
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
    armPaths: [pathOf(arm(32_400, 2.6, 80)), pathOf(arm(21_000, 2.6, 80)), pathOf(arm(16_000, 2.8, 80)), pathOf(arm(SOL_GALACTIC.y, 0.35, 20))],
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

// ===== Enemy territory on the map (G2-7) =====
//
// Each homeworld has one fixed sector per Tier II to VII (galaxy.ts homeworldPlacement enemySectors, user G8): the
// tier's band of distances across the bearings [startBearing, startBearing + widthBearing). The map is centered on the
// homeworld, so a band is a ring and a sector is a slice of it: the inner arc at the band's near edge, the outer arc at
// its far edge, on the same square-root scale as the rings (telescopeMapRingRadius). Bearing 0 points at the Galactic
// Core (up on the map, galaxy.ts bearingDirection), and bearings run clockwise on screen.
// THE IN-REACH RULE (user: "hide out-of-range"): a sector is drawn exactly when its tier is within the telescope's
// reach at this level (tier <= reachTier). A reached region's whole band lies inside the solid ring (telescope.ts
// rangeLyForReach is the farthest reached band's far edge), so a drawn slice never crosses the ring, and an unreached
// region shows no slice. THE LEGEND (user: "Once a sector is in range"): its line shows only when at least one slice
// is drawn. The provisional fixture has no sectors, so its map is unchanged.

export interface TelescopeMapEnemySector {
  tier: RegionTier;
  numeral: string;
  startBearing: number; // tenths of a degree, galaxy.ts
  widthBearing: number;
  innerR: number; // px from the homeworld: the band's near edge
  outerR: number; // px: the band's far edge
  path: string; // the closed slice
}

export interface TelescopeMapEnemyView {
  sectors: TelescopeMapEnemySector[]; // in reach only, nearest tier first
  tiers: RegionTier[]; // the tiers with a drawn slice (their key rows read "part enemy")
  legend: string | null; // null until a slice is drawn
  ariaSentence: string; // "" until a slice is drawn
}

// The map point (px) at `bearing` (tenths of a degree), `r` px from the homeworld. Pure.
export function telescopeMapBearingPoint(bearing: number, r: number): { x: number; y: number } {
  const a = (bearing / BEARING_TURN) * 2 * Math.PI;
  return { x: CX + Math.sin(a) * r, y: CY - Math.cos(a) * r };
}

// A sector's slice bounds on this homeworld's map: the near and far edge of its tier's band as ring radii. Pure.
export function telescopeMapSectorRadii(homeworld: HomeworldPlacement, tier: RegionTier): { innerR: number; outerR: number } {
  const band = homeworld.regionBandsLy[tier];
  return { innerR: telescopeMapRingRadius(homeworld, band.near), outerR: telescopeMapRingRadius(homeworld, band.far) };
}

// Whether a sector is drawn at this reach (the in-reach rule above). Pure.
export function enemySectorInReach(sector: Pick<EnemySector, "tier">, reachTier: number): boolean {
  return sector.tier <= reachTier;
}

function sectorPath(startBearing: number, widthBearing: number, innerR: number, outerR: number): string {
  const end = startBearing + widthBearing;
  const large = widthBearing > BEARING_TURN / 2 ? 1 : 0;
  const f = (p: { x: number; y: number }): string => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  const i0 = telescopeMapBearingPoint(startBearing, innerR);
  const o0 = telescopeMapBearingPoint(startBearing, outerR);
  const o1 = telescopeMapBearingPoint(end, outerR);
  const i1 = telescopeMapBearingPoint(end, innerR);
  return `M${f(i0)} L${f(o0)} A${outerR} ${outerR} 0 ${large} 1 ${f(o1)} L${f(i1)} A${innerR} ${innerR} 0 ${large} 0 ${f(i0)}Z`;
}

// "Tier II" / "Tiers II, III and V".
function tierListText(tiers: readonly RegionTier[]): string {
  const nums = tiers.map((t) => regionTierNumeral(t));
  if (nums.length === 1) return `Tier ${nums[0]}`;
  return `Tiers ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
}

// The enemy territory slices the map draws at this telescope level, and the words that go with them. Pure.
export function telescopeMapEnemyView(level: number, homeworld: HomeworldPlacement = PROVISIONAL_HOMEWORLD): TelescopeMapEnemyView {
  const { reachTier } = telescopeReadingAtLevel(level, homeworld);
  const sectors: TelescopeMapEnemySector[] = homeworld.enemySectors
    .filter((s) => enemySectorInReach(s, reachTier))
    .slice()
    .sort((a, b) => a.tier - b.tier)
    .map((s) => {
      const { innerR, outerR } = telescopeMapSectorRadii(homeworld, s.tier);
      return {
        tier: s.tier,
        numeral: regionTierNumeral(s.tier),
        startBearing: s.startBearing,
        widthBearing: s.widthBearing,
        innerR,
        outerR,
        path: sectorPath(s.startBearing, s.widthBearing, innerR, outerR),
      };
    });
  const tiers = [...new Set(sectors.map((s) => s.tier))];
  const steps = ENEMY_TERRITORY_COMBAT_STEP === 1 ? "one step" : `${ENEMY_TERRITORY_COMBAT_STEP} steps`;
  return {
    sectors,
    tiers,
    legend: sectors.length > 0 ? `Hatched: enemy territory. ${RISK_FACTOR_NAMES.combat} is ${steps} higher there.` : null,
    ariaSentence: sectors.length > 0 ? `Hatched sectors are enemy territory in ${tierListText(tiers)}.` : "",
  };
}
