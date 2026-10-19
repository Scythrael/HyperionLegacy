// Expedition Tiers G2-2 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-2): THE STAR CATALOG. Pure
// data and geometry; no draws (the candidate's draws live in expedition.ts, on their own salts).
//
//   CATALOG NAMES (user #6, "Yes indeed" to the mockup's catalog codes; user G9, 2026-10-16: "Retire them" for the
//   18 banked names): a new candidate system is named `<region code>-NNNN` (LB, OR, PE, SA, SC, GB, GC, the
//   mockup's codes), its bodies lettered b, c, d (bodyDesignation).
//   FAMOUS SYSTEMS (user #6: "Complete with famous options that exist in reality too. I 100% want Wolf-359 to be one
//   of them"): real stars and regions with their real galactic positions (galactic longitude and latitude in
//   degrees, distance from Sol in light-years, from the standard catalogs: SIMBAD / Gaia DR3 for the stars, the
//   usual published distances for the clusters and nebulae). Each lies in the stylized galaxy of galaxy.ts (Sol at
//   (0, 26,500), longitude 0 toward the core, so a bearing in tenths of a degree equals the longitude seen from Sol),
//   and its distance and bearing are MEASURED FROM THE PLAYER'S HOMEWORLD. Its tier is the region it lies in; the
//   catalog stores it, and starCatalog.test.ts proves, for 1,000 homeworld placements, that each lies inside that
//   tier's band of distances as measured from there. Sagittarius A* is the Galactic Core's own center.
//   [PROPOSAL list] the plan's list, with the astronomy above.
//
// Module graph: model (types), galaxy (the geometry). Imported by expedition.ts and the display modules.

import type { RegionTier } from "./model";
import { BEARING_TURN, SOL_GALACTIC, type GalacticPoint, type HomeworldPlacement } from "./galaxy";

// ===== Catalog names =====

// The region codes of the catalog names, Tier I to VII (the approved tiers mockup's).
export const REGION_CODES: Readonly<Record<RegionTier, string>> = { 1: "LB", 2: "OR", 3: "PE", 4: "SA", 5: "SC", 6: "GB", 7: "GC" };
// A catalog number runs 0001 to 9999 (four digits, never 0000).
export const CATALOG_NUMBER_MAX = 9_999;

// "LB-0472" and its id "lb-0472". Pure.
export function catalogSystemName(tier: RegionTier, number: number): { systemId: string; systemName: string } {
  const code = REGION_CODES[tier] ?? REGION_CODES[1];
  const digits = String(Math.max(1, Math.min(CATALOG_NUMBER_MAX, Math.floor(number)))).padStart(4, "0");
  return { systemId: `${code.toLowerCase()}-${digits}`, systemName: `${code}-${digits}` };
}

// A body's letter (b for the first, c, d, ...: the exoplanet convention, the star itself being "a"). Pure.
export function bodyLetter(index: number): string {
  const i = Math.max(0, Math.floor(index));
  return i < 25 ? String.fromCharCode(98 + i) : String(i + 1);
}

// ===== Famous systems =====

export interface FamousSystem {
  id: string;
  name: string;
  tier: RegionTier;
  longitude: number; // galactic longitude, degrees
  latitude: number; // galactic latitude, degrees
  distanceLy: number; // from Sol
}

// The catalog, in tier order. Wolf 359 is the user's (user #6, and G10 "Guaranteed early").
export const FAMOUS_SYSTEMS: readonly FamousSystem[] = [
  // Tier I, the Local Bubble: every one lies within 150 ly of Sol, so within the Local Bubble from every homeworld.
  { id: "alphaCentauri", name: "Alpha Centauri", tier: 1, longitude: 315.73, latitude: -0.68, distanceLy: 4.37 },
  { id: "barnardsStar", name: "Barnard's Star", tier: 1, longitude: 31.01, latitude: 14.06, distanceLy: 5.96 },
  { id: "wolf359", name: "Wolf 359", tier: 1, longitude: 244.05, latitude: 56.12, distanceLy: 7.86 },
  { id: "sirius", name: "Sirius", tier: 1, longitude: 227.23, latitude: -8.89, distanceLy: 8.6 },
  { id: "epsilonEridani", name: "Epsilon Eridani", tier: 1, longitude: 195.84, latitude: -48.05, distanceLy: 10.47 },
  { id: "tauCeti", name: "Tau Ceti", tier: 1, longitude: 173.1, latitude: -73.44, distanceLy: 11.91 },
  { id: "altair", name: "Altair", tier: 1, longitude: 47.74, latitude: -8.91, distanceLy: 16.73 },
  { id: "vega", name: "Vega", tier: 1, longitude: 67.45, latitude: 19.24, distanceLy: 25.04 },
  { id: "fomalhaut", name: "Fomalhaut", tier: 1, longitude: 20.49, latitude: -64.91, distanceLy: 25.13 },
  { id: "trappist1", name: "TRAPPIST-1", tier: 1, longitude: 69.71, latitude: -56.64, distanceLy: 40.66 },
  { id: "pegasi51", name: "51 Pegasi", tier: 1, longitude: 90.06, latitude: -34.73, distanceLy: 50.45 },
  // Tier II, the Orion Arm.
  { id: "polaris", name: "Polaris", tier: 2, longitude: 123.28, latitude: 26.46, distanceLy: 433 },
  { id: "betelgeuse", name: "Betelgeuse", tier: 2, longitude: 199.79, latitude: -8.96, distanceLy: 548 },
  { id: "antares", name: "Antares", tier: 2, longitude: 351.95, latitude: 15.06, distanceLy: 550 },
  { id: "rigel", name: "Rigel", tier: 2, longitude: 209.24, latitude: -25.25, distanceLy: 860 },
  { id: "orionNebula", name: "Orion Nebula", tier: 2, longitude: 209.01, latitude: -19.38, distanceLy: 1_344 },
  { id: "deneb", name: "Deneb", tier: 2, longitude: 84.28, latitude: 1.99, distanceLy: 2_615 },
  // Tier III, the Perseus Arm.
  { id: "doubleCluster", name: "Double Cluster", tier: 3, longitude: 134.63, latitude: -3.71, distanceLy: 7_460 },
  // Tier IV, the Sagittarius Arm.
  { id: "lagoonNebula", name: "Lagoon Nebula", tier: 4, longitude: 6.04, latitude: -1.25, distanceLy: 4_100 },
  { id: "eagleNebula", name: "Eagle Nebula", tier: 4, longitude: 16.95, latitude: 0.79, distanceLy: 5_700 },
  { id: "etaCarinae", name: "Eta Carinae", tier: 4, longitude: 287.6, latitude: -0.63, distanceLy: 7_470 }, // 2.29 kpc, inside the 2.3 kpc estimate's error
  // Tier V, the Scutum-Centaurus Arm.
  { id: "westerlund1", name: "Westerlund 1", tier: 5, longitude: 339.55, latitude: -0.4, distanceLy: 12_600 },
  // Tier VI, the Galactic Bulge.
  { id: "terzan5", name: "Terzan 5", tier: 6, longitude: 3.84, latitude: 1.69, distanceLy: 19_200 },
  // Tier VII, the Galactic Core: its center (placed at the stylized core's origin, below).
  { id: "sagittariusAStar", name: "Sagittarius A*", tier: 7, longitude: 359.94, latitude: -0.05, distanceLy: 26_500 },
];

// Wolf 359's catalog id (expedition.ts guarantees it early, user G10).
export const WOLF_359_ID = "wolf359";

export function famousSystem(id: string): FamousSystem | undefined {
  return FAMOUS_SYSTEMS.find((f) => f.id === id);
}

// The famous systems of a tier, catalog order. Pure.
export function famousSystemsOfTier(tier: RegionTier): FamousSystem[] {
  return FAMOUS_SYSTEMS.filter((f) => f.tier === tier);
}

// A famous system's place: its point in the galactic plane (galaxy.ts coordinates) and its height off the plane.
// Sagittarius A* sits exactly at the core's center. Pure.
export function famousSystemPosition(f: FamousSystem): { point: GalacticPoint; heightLy: number } {
  if (f.id === "sagittariusAStar") return { point: { x: 0, y: 0 }, heightLy: 0 };
  const l = (f.longitude * Math.PI) / 180;
  const b = (f.latitude * Math.PI) / 180;
  const inPlane = f.distanceLy * Math.cos(b);
  return { point: { x: SOL_GALACTIC.x + inPlane * Math.sin(l), y: SOL_GALACTIC.y - inPlane * Math.cos(l) }, heightLy: f.distanceLy * Math.sin(b) };
}

// A famous system as seen from a homeworld: its distance (whole light-years, the way every band edge and candidate
// distance reads; the homeworld lies in the galactic plane) and its bearing (whole tenths of a degree, galaxy.ts
// bearingDirection's convention). Pure.
export function famousSystemFrom(f: FamousSystem, homeworld: Pick<HomeworldPlacement, "galactic">): { distanceLy: number; bearing: number } {
  const { point, heightLy } = famousSystemPosition(f);
  const dx = point.x - homeworld.galactic.x;
  const dy = point.y - homeworld.galactic.y;
  const a = Math.atan2(dx, -dy); // 0 toward the core (-y), a quarter turn toward +x
  const bearing = (((Math.round((a / (2 * Math.PI)) * BEARING_TURN) % BEARING_TURN) + BEARING_TURN) % BEARING_TURN);
  return { distanceLy: Math.round(Math.hypot(dx, dy, heightLy)), bearing };
}
