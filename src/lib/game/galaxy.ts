// Expedition Tiers G2-1 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-1): THE GALAXY MODEL. Pure.
//
//   THE REGION LADDER (moved here from telescope.ts, which re-exports it so no caller changes): the seven expedition
//   regions, Tier I Local Bubble to Tier VII Galactic Core (gas giant design 1c; Roman numerals in game).
//   A STYLIZED GALAXY in galactic coordinates (light-years, the Galactic Core at the origin, +y outward away from the
//   core): Sol at (0, 26,500), and each region's FAR EDGE as a point plus a depth (FAR_EDGES below). Measured from Sol
//   the bands are exactly the approved tiers mockup's (the pre-G2 PROVISIONAL_HOMEWORLD, which a test pins).
//   THE HOMEWORLD (user G1, 2026-10-16: "Local Bubble, 10-120 ly"): every save stores ONE seed
//   (GameState.homeworld, model.ts HomeworldState), drawn once from real entropy at new game (App.svelte, through
//   homeworldEntropy.ts) or at the SAVE v70 migration (user G2: "Random for everyone"). The placement is DERIVED from
//   the seed (homeworldPlacement), never stored twice: a whole light-year point 10 to 120 ly from Sol, so Tier I stays
//   local, Wolf 359 (7.9 ly from Sol) stays a Tier I system and players differ by tens of light-years.
//   ENEMY TERRITORY (user G8, 2026-10-16: "Fixed sectors on the map"): fixed sectors on each player's map, placed from
//   the same seed on their own salt. [PROPOSAL layout] one sector per tier II to VII: the tier's band of distances
//   across a wedge of bearings whose width is the tier's share of a full turn (ENEMY_SECTOR_WIDTH_PERMILLE, the open
//   call 8 percentages), so a system at a uniform bearing is in enemy territory at that rate; Tier I has none.
//   G2-2 HOOK: a candidate gets a bearing (its own salt) and reads inEnemySector; the telescope map shades the sectors
//   (G2-7); launched runs freeze the flag in their stamps. G2-9 close-out (user 2026-11-11, "Label + point inward"): the Tier VI and VII
//   sectors are aimed at the Galactic Core (CORE_AIMED_SECTOR_TIERS).
//
// DISPLAY ONLY at G2-1: the placement moves the light-years the telescope and the candidates show; no run reads it.
// Determinism: integer draws only (makeRng, nextInt); the placement is lattice points. One exception: coreBearingFrom
// uses atan2 to aim the Tier VI and VII sectors; over every homeworld lattice point (241 x 241) the nearest value to a
// rounding edge is 5e-4, so the result is identical on every browser.
//
// Module graph: model (types only), combat/rng. Imported by telescope.ts (re-exports), expedition.ts and the UI.

import type { GameState, HomeworldState, RegionTier } from "./model";
import { makeRng } from "./combat/rng";

// ===== The region ladder =====

export const REGION_TIERS: readonly RegionTier[] = [1, 2, 3, 4, 5, 6, 7];

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
// THE shared tier formatter (user 2026-10-12: "let's make sure the game displays roman numerals"; G2-9 close-out, user
// 2026-11-11 "Everything (Recommended)": every tier shown anywhere, research, gear, blueprints, missions, storage and
// expeditions alike). Display only: identifiers and saved data keep their numbers. A whole number 1 to 3,999 reads as
// a Roman numeral ("IV"); anything else reads as written. Pure.
const ROMAN_STEPS: readonly (readonly [number, string])[] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
export function tierNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3_999) return String(n);
  let left = n;
  let out = "";
  for (const [value, glyph] of ROMAN_STEPS) {
    while (left >= value) {
      out += glyph;
      left -= value;
    }
  }
  return out;
}
export function regionTierNumeral(tier: RegionTier): string {
  return tierNumeral(tier);
}

// ===== The stylized galaxy =====

export interface GalacticPoint {
  x: number;
  y: number;
}

// A region's band of distances from a homeworld, in light-years (a system of that region lies in (near, far]).
export interface RegionBandLy {
  near: number;
  far: number;
}

// One fixed enemy territory sector: the tier's band of distances across the bearings [startBearing, startBearing +
// widthBearing), in tenths of a degree from the homeworld (bearingDirection), wrapping past 3,600.
export interface EnemySector {
  tier: RegionTier;
  startBearing: number;
  widthBearing: number;
}

export interface HomeworldPlacement {
  id: string;
  galactic: GalacticPoint; // the homeworld's position (core at the origin)
  distanceFromSolLy: number;
  distanceFromCoreLy: number; // the homeworld's galactic radius, whole light-years
  regionBandsLy: Readonly<Record<RegionTier, RegionBandLy>>;
  enemySectors: readonly EnemySector[];
}

export const SOL_GALACTIC: GalacticPoint = { x: 0, y: 26_500 };
// The Local Bubble band starts at the nearest-star distance (Proxima Centauri, about 4.2 ly from Sol).
export const NEAREST_STAR_LY = 4;
const LOCAL_BUBBLE_RADIUS_LY = 150;
const GALACTIC_CORE_RADIUS_LY = 1_500;

// Each region's FAR EDGE as seen from a point P: |P - anchor| + depthLy, in light-years. From Sol: the Local Bubble
// (a 150 ly bubble around Sol) to 150 ly, the Orion Arm to 3,000 ly, Perseus (about 6,400 ly outward, 1,200 ly deep)
// and Sagittarius (about 5,000 ly inward, 2,600 ly deep) both to 7,600 ly, Scutum-Centaurus to 13,000 ly, the
// Bulge to the Core's near edge (25,000 ly) and the Core to its center (26,500 ly).
const FAR_EDGES: Readonly<Record<RegionTier, { anchor: GalacticPoint; depthLy: number }>> = {
  1: { anchor: SOL_GALACTIC, depthLy: LOCAL_BUBBLE_RADIUS_LY },
  2: { anchor: SOL_GALACTIC, depthLy: 3_000 },
  3: { anchor: { x: 0, y: 26_500 + 6_400 }, depthLy: 1_200 },
  4: { anchor: { x: 0, y: 26_500 - 5_000 }, depthLy: 2_600 },
  5: { anchor: { x: 0, y: 26_500 - 13_000 }, depthLy: 0 },
  6: { anchor: { x: 0, y: 0 }, depthLy: -GALACTIC_CORE_RADIUS_LY },
  7: { anchor: { x: 0, y: 0 }, depthLy: 0 },
};

// The rungs of bands, nearest first. Perseus and Sagittarius share ONE band (one telescope rung reaches both, design
// 6.2): its far edge is the farther of the two arms' far edges as measured from the point.
const RUNGS: readonly (readonly RegionTier[])[] = [[1], [2], [3, 4], [5], [6], [7]];

// Each region's band as measured from `from`: a rung's far edge is its farthest region's far edge (whole light-years,
// at least 1 ly past its near edge); its near edge is the rung below's far edge (the Local Bubble's is the
// nearest-star distance). So bands are ordered and never overlap, and "distance <= range" is exactly "region tier
// <= reach tier" at every telescope level (galaxy.test.ts, 1,000 placements). Pure.
export function regionBandsFrom(from: GalacticPoint): Record<RegionTier, RegionBandLy> {
  const bands = {} as Record<RegionTier, RegionBandLy>;
  let near = NEAREST_STAR_LY;
  for (const rung of RUNGS) {
    const edge = Math.max(
      ...rung.map((t) => Math.round(Math.hypot(from.x - FAR_EDGES[t].anchor.x, from.y - FAR_EDGES[t].anchor.y) + FAR_EDGES[t].depthLy)),
    );
    const far = Math.max(edge, near + 1);
    for (const t of rung) bands[t] = { near, far };
    near = far;
  }
  return bands;
}

// ===== Bearings =====

// A bearing in tenths of a degree from the homeworld: 0 points at the Galactic Core, 900 a quarter turn on (+x).
export const BEARING_TURN = 3_600;
export function bearingDirection(bearing: number): GalacticPoint {
  const a = (bearing / BEARING_TURN) * 2 * Math.PI;
  return { x: Math.sin(a), y: -Math.cos(a) };
}
const normBearing = (b: number): number => ((Math.floor(b) % BEARING_TURN) + BEARING_TURN) % BEARING_TURN;

// ===== The homeworld placement (user G1) =====

export const HOMEWORLD_MIN_FROM_SOL_LY = 10;
export const HOMEWORLD_MAX_FROM_SOL_LY = 120;
export const HOMEWORLD_PLACEMENT_SALT = 0x3f1a5c97;
export const ENEMY_SECTOR_SALT = 0x52e7b4c1;
// [PROPOSAL, user G8 layout] each tier's sector width in per-mille of a full turn (open call 8's per-tier shares).
export const ENEMY_SECTOR_WIDTH_PERMILLE: Readonly<Record<RegionTier, number>> = { 1: 0, 2: 50, 3: 150, 4: 250, 5: 350, 6: 450, 7: 500 };
// A rejection draw that fails this many times in a row (odds about 0.23 ^ 64) falls back to a fixed spot.
const PLACEMENT_ATTEMPTS = 64;

// The homeworld's offset from Sol: a uniform whole light-year lattice point with 10 <= |offset| <= 120, by rejection
// over the square (integer draws only, so no trigonometry enters the placement). Pure.
function offsetFromSol(seed: number): GalacticPoint {
  const rng = makeRng((seed ^ HOMEWORLD_PLACEMENT_SALT) >>> 0);
  const max = HOMEWORLD_MAX_FROM_SOL_LY;
  const lo = HOMEWORLD_MIN_FROM_SOL_LY * HOMEWORLD_MIN_FROM_SOL_LY;
  const hi = max * max;
  for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
    const x = rng.nextInt(2 * max + 1) - max;
    const y = rng.nextInt(2 * max + 1) - max;
    const d2 = x * x + y * y;
    if (d2 >= lo && d2 <= hi) return { x, y };
  }
  return { x: 0, y: HOMEWORLD_MIN_FROM_SOL_LY };
}

// G2-9 close-out (user 2026-11-11, "Label + point inward (Recommended)"): the inner regions' sectors point toward the
// Galactic Core. Tier VI (the Bulge) and Tier VII (the Core) lie toward the core from every homeworld, so their slices
// are aimed at it: the core's direction sits in the middle half of the slice (never closer than a quarter of the
// slice's width to an edge), and the draw still varies the slice from save to save within that.
export const CORE_AIMED_SECTOR_TIERS: readonly RegionTier[] = [6, 7];

// The bearing from `from` toward the Galactic Core (the origin), whole tenths of a degree in [0, 3,600): the direction
// the telescope map draws the core in (0 when the point sits on the Sol-core line). Pure.
export function coreBearingFrom(from: GalacticPoint): number {
  if (Math.hypot(from.x, from.y) < 1) return 0;
  return normBearing(Math.round((Math.atan2(-from.x, from.y) * BEARING_TURN) / (2 * Math.PI)));
}

// The fixed enemy territory sectors of a seed (user G8): one draw per tier I to VII in order (Tier I's draw is kept
// with its value unused, so retuning Tier I never moves another tier's sector). A core-aimed tier (CORE_AIMED_SECTOR_TIERS)
// uses its draw to place the slice so the core's bearing from `galactic` lies in its middle half. Pure.
function enemySectorsOf(seed: number, galactic: GalacticPoint): EnemySector[] {
  const rng = makeRng((seed ^ ENEMY_SECTOR_SALT) >>> 0);
  const out: EnemySector[] = [];
  const core = coreBearingFrom(galactic);
  for (const tier of REGION_TIERS) {
    const drawn = rng.nextInt(BEARING_TURN);
    const widthBearing = (ENEMY_SECTOR_WIDTH_PERMILLE[tier] * BEARING_TURN) / 1000;
    if (widthBearing <= 0) continue;
    let startBearing = drawn;
    if (CORE_AIMED_SECTOR_TIERS.includes(tier)) {
      // The core sits `offset` past the slice's start, offset in [width / 4, 3 * width / 4].
      const quarter = Math.floor(widthBearing / 4);
      const offset = quarter + (drawn % (Math.floor(widthBearing / 2) + 1));
      startBearing = normBearing(core - offset);
    }
    out.push({ tier, startBearing, widthBearing });
  }
  return out;
}

// A save's homeworld, derived from its stored seed. Pure.
export function homeworldPlacement(seed: number): HomeworldPlacement {
  const s = seed >>> 0;
  const off = offsetFromSol(s);
  const galactic = { x: SOL_GALACTIC.x + off.x, y: SOL_GALACTIC.y + off.y };
  return {
    id: `homeworld-${s.toString(16)}`,
    galactic,
    distanceFromSolLy: Math.hypot(off.x, off.y),
    distanceFromCoreLy: Math.round(Math.hypot(galactic.x, galactic.y)),
    regionBandsLy: regionBandsFrom(galactic),
    enemySectors: enemySectorsOf(s, galactic),
  };
}

// Whether a system of `tier` at `bearing` from the homeworld lies in that tier's enemy territory sector. Pure.
export function inEnemySector(homeworld: HomeworldPlacement, tier: RegionTier, bearing: number): boolean {
  const b = normBearing(bearing);
  return homeworld.enemySectors.some((s) => s.tier === tier && (b - s.startBearing + BEARING_TURN) % BEARING_TURN < s.widthBearing);
}

// ===== The provisional homeworld (the pre-G2 fixture) =====

// ⚠️ The ONE shared homeworld every save read before G2-1: Sol's own position, with the tiers mockup's bands and no
// enemy territory. Kept as the TEST FIXTURE and as what a state without a stored homeworld reads (freshState with no
// seed in tests and the sim, a pre-G2 fixture). Never a real save's: every new game stores its own seed, and every
// load seeds one when missing (save.ts migrate runs withHomeworldV70 on every load, whatever the version).
export const PROVISIONAL_HOMEWORLD: HomeworldPlacement = {
  id: "provisionalNearSol",
  galactic: SOL_GALACTIC,
  distanceFromSolLy: 0,
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
  enemySectors: [],
};

// ===== The stored homeworld =====

// A stored homeworld is { version: 1, seed: a whole number in [0, 2^32) }. Pure.
export function isWellFormedHomeworld(value: unknown): value is HomeworldState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.seed === "number" && Number.isInteger(v.seed) && v.seed >= 0 && v.seed <= 0xffffffff;
}

// The state's homeworld placement: derived from its stored seed, or the provisional spot when it has none. Pure.
export function stateHomeworld(state: Pick<GameState, "homeworld">): HomeworldPlacement {
  return isWellFormedHomeworld(state.homeworld) ? homeworldPlacement(state.homeworld.seed) : PROVISIONAL_HOMEWORLD;
}
