// Expedition Tiers G2-1 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-1): the stylized galaxy, each
// save's homeworld placement (user G1: a random point inside the Local Bubble, 10 to 120 ly from Sol), the region bands
// measured from it, and the fixed enemy territory sectors on each player's map (user G8).

import { describe, expect, it } from "vitest";
import { freshState, type GameState, type RegionTier } from "./model";
import {
  ENEMY_SECTOR_WIDTH_PERMILLE,
  HOMEWORLD_MAX_FROM_SOL_LY,
  HOMEWORLD_MIN_FROM_SOL_LY,
  NEAREST_STAR_LY,
  PROVISIONAL_HOMEWORLD,
  REGION_TIER_NAMES,
  SOL_GALACTIC,
  bearingDirection,
  homeworldPlacement,
  inEnemySector,
  isWellFormedHomeworld,
  regionBandsFrom,
  regionTierNumeral,
  stateHomeworld,
} from "./galaxy";
import * as telescope from "./telescope";
import { rangeLyForReach, systemDistanceLy, telescopeReadingAtLevel } from "./telescope";

const TIERS: RegionTier[] = [1, 2, 3, 4, 5, 6, 7];
const SEEDS = Array.from({ length: 1000 }, (_, i) => (Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);

describe("G2-1: the region ladder moved to galaxy.ts, re-exported by telescope.ts", () => {
  it("telescope.ts re-exports the same values, so callers do not change", () => {
    expect(telescope.REGION_TIER_NAMES).toBe(REGION_TIER_NAMES);
    expect(telescope.regionTierNumeral).toBe(regionTierNumeral);
    expect(telescope.PROVISIONAL_HOMEWORLD).toBe(PROVISIONAL_HOMEWORLD);
  });
});

describe("G2-1: the stylized galaxy measured from a point", () => {
  it("measured from Sol, the bands are exactly the pre-G2 provisional bands (the approved ladder)", () => {
    expect(regionBandsFrom(SOL_GALACTIC)).toEqual(PROVISIONAL_HOMEWORLD.regionBandsLy);
    expect(PROVISIONAL_HOMEWORLD.galactic).toEqual(SOL_GALACTIC);
    expect(PROVISIONAL_HOMEWORLD.distanceFromCoreLy).toBe(26_500);
  });

  it("the Local Bubble band starts at the nearest-star distance; Perseus and Sagittarius share one band", () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const bands = homeworldPlacement(seed).regionBandsLy;
      expect(bands[1].near).toBe(NEAREST_STAR_LY);
      expect(bands[3]).toEqual(bands[4]);
    }
  });

  it("bands are whole light-years, ordered, and never overlap: each starts where the rung below ends", () => {
    for (const seed of SEEDS) {
      const b = homeworldPlacement(seed).regionBandsLy;
      for (const t of TIERS) {
        expect(Number.isInteger(b[t].near) && Number.isInteger(b[t].far), `seed ${seed} tier ${t}`).toBe(true);
        expect(b[t].far).toBeGreaterThan(b[t].near);
      }
      expect(b[2].near).toBe(b[1].far);
      expect(b[3].near).toBe(b[2].far);
      expect(b[5].near).toBe(b[3].far);
      expect(b[6].near).toBe(b[5].far);
      expect(b[7].near).toBe(b[6].far);
    }
  });
});

describe("G2-1: homeworld placement from the stored seed (user G1)", () => {
  it("is deterministic: the same seed gives the identical placement", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(homeworldPlacement(seed)).toEqual(homeworldPlacement(seed));
  });

  it("lands inside the Local Bubble, 10 to 120 ly from Sol, on whole light-year coordinates", () => {
    expect([HOMEWORLD_MIN_FROM_SOL_LY, HOMEWORLD_MAX_FROM_SOL_LY]).toEqual([10, 120]);
    for (const seed of SEEDS) {
      const p = homeworldPlacement(seed);
      expect(Number.isInteger(p.galactic.x) && Number.isInteger(p.galactic.y)).toBe(true);
      const d = Math.hypot(p.galactic.x - SOL_GALACTIC.x, p.galactic.y - SOL_GALACTIC.y);
      expect(d).toBe(p.distanceFromSolLy);
      expect(d, `seed ${seed}`).toBeGreaterThanOrEqual(10);
      expect(d, `seed ${seed}`).toBeLessThanOrEqual(120);
      expect(p.distanceFromCoreLy).toBe(Math.round(Math.hypot(p.galactic.x, p.galactic.y)));
      // Inside the Local Bubble: Sol (and everything within 150 ly of it, so Wolf 359 at 7.9 ly) reads Tier I.
      expect(d + 8).toBeLessThanOrEqual(p.regionBandsLy[1].far);
    }
  });

  it("players differ: 1,000 seeds give many distinct spots spread around Sol on every side", () => {
    const placements = SEEDS.map(homeworldPlacement);
    expect(new Set(placements.map((p) => `${p.galactic.x},${p.galactic.y}`)).size).toBeGreaterThan(900);
    expect(placements.some((p) => p.galactic.x > 60) && placements.some((p) => p.galactic.x < -60)).toBe(true);
    expect(placements.some((p) => p.galactic.y > SOL_GALACTIC.y + 60) && placements.some((p) => p.galactic.y < SOL_GALACTIC.y - 60)).toBe(true);
  });

  it("distance <= range equals region tier <= reach tier, for 1,000 placements at every telescope level", () => {
    for (const seed of SEEDS) {
      const home = homeworldPlacement(seed);
      for (let level = 0; level <= 8; level++) {
        const reading = telescopeReadingAtLevel(level, home);
        expect(reading.rangeLy).toBe(rangeLyForReach(reading.reachTier, home));
        for (const tier of TIERS) {
          // One drawn system per tier (a distinct system seed per tier).
          const d = systemDistanceLy(seed ^ (tier * 0x55aa), tier, home);
          const inRange = reading.reachTier > 0 && d <= reading.rangeLy;
          expect(inRange, `seed ${seed} level ${level} tier ${tier}`).toBe(tier <= reading.reachTier);
          // The band edges themselves: the far edge reads in range exactly when the tier is reached.
          const band = home.regionBandsLy[tier];
          expect(reading.reachTier > 0 && band.far <= reading.rangeLy).toBe(tier <= reading.reachTier);
          expect(reading.reachTier > 0 && band.near + 1 <= reading.rangeLy).toBe(tier <= reading.reachTier);
        }
      }
    }
  }, 60_000);
});

describe("G2-1: enemy territory as fixed sectors on each player's map (user G8)", () => {
  it("one sector per tier, Tier I has none, widths are the per-tier shares of a full turn", () => {
    expect(ENEMY_SECTOR_WIDTH_PERMILLE).toEqual({ 1: 0, 2: 50, 3: 150, 4: 250, 5: 350, 6: 450, 7: 500 });
    for (const seed of SEEDS.slice(0, 200)) {
      const sectors = homeworldPlacement(seed).enemySectors;
      expect(sectors.map((s) => s.tier)).toEqual([2, 3, 4, 5, 6, 7]);
      for (const s of sectors) {
        expect(Number.isInteger(s.startBearing) && s.startBearing >= 0 && s.startBearing < 3600).toBe(true);
        expect(s.widthBearing).toBe((ENEMY_SECTOR_WIDTH_PERMILLE[s.tier] * 3600) / 1000);
      }
    }
  });

  it("placed deterministically from the same seed, and differently for different players", () => {
    expect(homeworldPlacement(SEEDS[3]).enemySectors).toEqual(homeworldPlacement(SEEDS[3]).enemySectors);
    const layouts = new Set(SEEDS.slice(0, 100).map((s) => JSON.stringify(homeworldPlacement(s).enemySectors)));
    expect(layouts.size).toBe(100);
  });

  it("membership: a bearing is inside exactly the share of the turn its tier's sector covers; Tier I never", () => {
    const home = homeworldPlacement(SEEDS[0]);
    for (const tier of TIERS) {
      let inside = 0;
      for (let b = 0; b < 3600; b++) if (inEnemySector(home, tier, b)) inside += 1;
      expect(inside, `tier ${tier}`).toBe((ENEMY_SECTOR_WIDTH_PERMILLE[tier] * 3600) / 1000);
    }
    // A sector that wraps past bearing 0 still covers its whole width.
    const wrap = { ...home, enemySectors: [{ tier: 2 as RegionTier, startBearing: 3500, widthBearing: 180 }] };
    expect([3499, 3500, 3599, 0, 79, 80].map((b) => inEnemySector(wrap, 2, b))).toEqual([false, true, true, true, true, false]);
    expect(inEnemySector(wrap, 2, 3600 + 10)).toBe(true);
    expect(inEnemySector(wrap, 2, -10)).toBe(true);
    // The pre-G2 fixture has no sectors.
    expect(PROVISIONAL_HOMEWORLD.enemySectors).toEqual([]);
  });

  it("bearings: 0 points at the Galactic Core, 900 a quarter turn on", () => {
    const toCore = bearingDirection(0);
    expect(toCore.x).toBeCloseTo(0, 12);
    expect(toCore.y).toBeCloseTo(-1, 12);
    const quarter = bearingDirection(900);
    expect(quarter.x).toBeCloseTo(1, 12);
    expect(quarter.y).toBeCloseTo(0, 12);
  });
});

describe("G2-1: the stored homeworld on the save", () => {
  it("freshState stores the seed it is given; the placement is derived, never stored", () => {
    expect(freshState(12345).homeworld).toEqual({ version: 1, seed: 12345 });
    expect(stateHomeworld(freshState(12345))).toEqual(homeworldPlacement(12345));
    expect(Object.keys(freshState(12345).homeworld!).sort()).toEqual(["seed", "version"]);
  });

  it("freshState with no seed (tests, the sim) stores none and reads the provisional spot, so pre-G2 goldens hold", () => {
    expect("homeworld" in freshState()).toBe(false);
    expect(stateHomeworld(freshState())).toBe(PROVISIONAL_HOMEWORLD);
    const { homeworld: _h, ...seeded } = freshState(12345);
    expect(seeded).toEqual(freshState());
  });

  it("a seed is stored as an unsigned 32-bit integer", () => {
    expect(freshState(-1).homeworld).toEqual({ version: 1, seed: 0xffffffff });
    expect(freshState(2 ** 32 + 5).homeworld).toEqual({ version: 1, seed: 5 });
  });

  it("a state with no homeworld (a pre-G2 fixture) or a malformed one reads the provisional spot near Sol", () => {
    const { homeworld: _h, ...rest } = freshState(777);
    expect(stateHomeworld(rest as GameState)).toBe(PROVISIONAL_HOMEWORLD);
    for (const bad of [null, 5, { version: 2, seed: 1 }, { version: 1, seed: 1.5 }, { version: 1, seed: -1 }, { version: 1 }]) {
      expect(isWellFormedHomeworld(bad)).toBe(false);
      expect(stateHomeworld({ ...freshState(), homeworld: bad } as unknown as GameState)).toBe(PROVISIONAL_HOMEWORLD);
    }
    expect(isWellFormedHomeworld({ version: 1, seed: 0 })).toBe(true);
  });
});
