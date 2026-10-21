// Expedition Tiers G2-2: the star catalog (starCatalog.ts). Famous systems land in their own tier's band from every
// homeworld; names and letters read as the mockup's.

import { describe, expect, it } from "vitest";
import { PROVISIONAL_HOMEWORLD, homeworldPlacement } from "./galaxy";
import {
  FAMOUS_SYSTEMS,
  REGION_CODES,
  WOLF_359_ID,
  bodyLetter,
  catalogSystemName,
  famousSystem,
  famousSystemFrom,
  famousSystemsOfTier,
} from "./starCatalog";
import type { RegionTier } from "./model";

const PLACEMENTS = Array.from({ length: 1_000 }, (_, i) => homeworldPlacement(Math.imul(i + 1, 0x9e3779b1) >>> 0));

describe("star catalog (G2-2)", () => {
  it("every famous system lies inside its own tier's band, as measured from 1,000 homeworlds and from Sol", () => {
    for (const home of [PROVISIONAL_HOMEWORLD, ...PLACEMENTS]) {
      for (const f of FAMOUS_SYSTEMS) {
        const band = home.regionBandsLy[f.tier];
        const { distanceLy } = famousSystemFrom(f, home);
        expect(distanceLy, `${f.name} from ${home.id}`).toBeLessThanOrEqual(band.far);
        // Tier I's near edge is the nearest-star distance; a homeworld may sit closer than that to a near star (the
        // candidate clamps it into the band), every deeper system lies strictly past its band's near edge.
        if (f.tier > 1) expect(distanceLy, `${f.name} from ${home.id}`).toBeGreaterThan(band.near);
      }
    }
  });

  it("every tier holds at least one famous system; Wolf 359 is a Tier I system; ids are unique", () => {
    for (const t of [1, 2, 3, 4, 5, 6, 7] as RegionTier[]) expect(famousSystemsOfTier(t).length).toBeGreaterThan(0);
    expect(famousSystem(WOLF_359_ID)).toMatchObject({ name: "Wolf 359", tier: 1 });
    expect(new Set(FAMOUS_SYSTEMS.map((f) => f.id)).size).toBe(FAMOUS_SYSTEMS.length);
    expect(new Set(FAMOUS_SYSTEMS.map((f) => f.name)).size).toBe(FAMOUS_SYSTEMS.length);
  });

  it("measured from Sol: the real distance (whole ly), and the bearing is the galactic longitude in tenths of a degree", () => {
    for (const f of FAMOUS_SYSTEMS.filter((x) => x.id !== "sagittariusAStar")) {
      const seen = famousSystemFrom(f, PROVISIONAL_HOMEWORLD);
      expect(Math.abs(seen.distanceLy - f.distanceLy)).toBeLessThanOrEqual(0.5);
      const tenths = Math.round(f.longitude * 10) % 3_600;
      expect(Math.abs(seen.bearing - tenths), f.name).toBeLessThanOrEqual(1);
    }
    // Sagittarius A* is the core's center: straight at the core from Sol.
    expect(famousSystemFrom(famousSystem("sagittariusAStar")!, PROVISIONAL_HOMEWORLD)).toEqual({ distanceLy: 26_500, bearing: 0 });
  });

  it("catalog names and body letters", () => {
    expect(catalogSystemName(1, 472)).toEqual({ systemId: "lb-0472", systemName: "LB-0472" });
    expect(catalogSystemName(7, 9_999)).toEqual({ systemId: "gc-9999", systemName: "GC-9999" });
    expect(catalogSystemName(3, 0).systemName).toBe("PE-0001");
    expect(Object.values(REGION_CODES)).toEqual(["LB", "OR", "PE", "SA", "SC", "GB", "GC"]);
    expect([0, 1, 2, 3].map(bodyLetter)).toEqual(["b", "c", "d", "e"]);
  });
});
