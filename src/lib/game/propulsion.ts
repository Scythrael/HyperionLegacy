// Expedition Tiers G2-4 (docs/plans/2026-10-14-expedition-tiers-g2-plan.md section 3 G2-4): PROPULSION, THE REACH GATE
// AND FRONTIER SENSORS. Pure.
//
// What a ship needs to attempt a region tier, and the reasons it is refused (the dispatch console, G2-6, shows them;
// startExpedition enforces them). User decisions (verbatim records in the plan's USER ANSWERS, 2026-10-16):
//   - Non-explorer hulls: "no current non-explorer hull can reach ANY expedition system", Tier I included, with the
//     reason shown (notExplorer).
//   - G3 drive class: "A combination of higher tier ships and better drive blueprints/stats/etc." A ship's class is its
//     hull's base class plus what its installed FTL drive adds (shipDriveClass); a tier asks for a class at least its
//     own number (voyage.ts tierMinimumDriveClass). G20: "Class IV drive", Roman numerals, no franchise term.
//   - G4 reach: "One reach stat (Recommended)": real light-years = today's range x a drive class multiplier x
//     Engineering (the long-haul ramp on the voyage's own round trip), against the round trip to the system.
//   - G7 frontier sensors: "Sensor gate per tier (Recommended)": I 0, II 10, III 20, IV 30, V 40, VI 55, VII 65.
//   - Mockup sign-off (2026-10-21, "as drawn"): the five reasons and their exact texts; a tier shows the FIRST unmet gate
//     (explorer, drive, then sensors); reach is checked per system; "None can be built yet" for a class no blueprint and
//     no hull can give today.
//
// ONE drive class source (E-MOD EM-1 carry note): the voyage's class (expedition.ts candidateVoyage) and the drive's
// power draw (model.ts equipmentStatMods) both read model.ts ftlDriveClass; the hull's base class adds on top here and
// never draws power (it is the frame's own, built in).
//
// Module graph: model, galaxy, crewOverlay, tick (the gear-inclusive trip range), equipment. Imported by expedition.ts.

import { BLUEPRINTS, SHIP_TYPES, ftlDriveClass, type GameState, type RegionTier, type ShipInstance, type ShipTypeKey } from "./model";
import { REGION_TIER_NAMES, regionTierNumeral } from "./galaxy";
import { effectiveShipStats } from "./crewOverlay";
import { shipTripRangeLightYears } from "./tick";
import { fittedInSlot } from "./equipment";
import { tierMinimumDriveClass } from "./voyage";

// The drive class ladder: Class I to VII (one per region tier).
export const DRIVE_CLASS_MAX = 7;

// [PROPOSAL] (user G3 reading, plan USER ANSWERS: "higher tier hulls carry a better base class"): a hull's BASE drive
// class from its tier, one class below it, never below Class I. Every hull built today (tiers 1 to 3) reads Class I
// except the tier 3 warships (Class II), which are not explorers; a future tier 3 explorer starts at Class II. The ONE
// place this rule is written.
export function hullBaseDriveClass(typeKey: ShipTypeKey): number {
  const tier = SHIP_TYPES[typeKey]?.tier ?? 1;
  return Math.max(1, Math.floor(tier) - 1);
}

// A ship's drive class: its hull's base class plus the classes its installed FTL drive adds above Class I
// (ftlDriveClass: the drive blueprint's class; a Standard-Issue or Class I piece adds nothing, an empty slot adds
// nothing), at most DRIVE_CLASS_MAX (no Class VIII exists). Pure.
export function shipDriveClass(state: Pick<GameState, "equipment">, ship: Pick<ShipInstance, "id" | "typeKey">): number {
  const drive = fittedInSlot(state as GameState, ship.id, "ftlDrive");
  const added = drive ? ftlDriveClass(drive) - 1 : 0;
  return Math.min(DRIVE_CLASS_MAX, hullBaseDriveClass(ship.typeKey) + added);
}

// The highest drive class any ship can reach today: the best explorer hull's base class plus the best classed drive
// blueprint the facility tracks serve (model.ts drivesWithinFacilityReach puts them in BLUEPRINTS). A tier above it
// reads "None can be built yet" (driveClassUnavailable). Pure over the static tables.
export function buildableDriveClassMax(): number {
  let hull = 1;
  for (const key of Object.keys(SHIP_TYPES) as ShipTypeKey[]) if (SHIP_TYPES[key].spec === "explorer") hull = Math.max(hull, hullBaseDriveClass(key));
  let drive = 1;
  for (const bp of Object.values(BLUEPRINTS)) {
    if (bp.equipmentOutput?.slotType !== "ftlDrive") continue;
    drive = Math.max(drive, bp.driveClass !== undefined && bp.driveClass > 1 ? Math.floor(bp.driveClass) : 1);
  }
  return Math.min(DRIVE_CLASS_MAX, hull + drive - 1);
}

// ===== The reach gate (user G4) =====

// [PROPOSAL] The deep-space reach multiplier per drive class: the ship's gear-inclusive range (the mission and patrol
// range, shipRangeLightYears, unchanged) times this. Fitted to the galaxy's bands rather than a fixed ratio, because
// the bands are front-loaded (the Local Bubble to the Orion Arm is x20, the Bulge to the Core x1.06): a stock Aurora
// (224 ly) at each class reaches about 90% of that class's region round trip from the farthest homeworld, so the
// farthest systems ask for better range gear or Engineering ("and further", user #2), and Class I reaches every Tier I
// system from every homeworld with room to spare (the stock Eir, 195 ly, reaches 780 ly against the farthest Tier I
// round trip of 540 ly: "T1 open from the start, absolutely").
export const DRIVE_CLASS_REACH_MULT: Readonly<Record<number, number>> = { 1: 4, 2: 24, 3: 62, 4: 68, 5: 105, 6: 200, 7: 240 };

// The reach multiplier of `driveClass` (clamped to the ladder). Pure.
export function driveClassReachMult(driveClass: number): number {
  const c = Math.max(1, Math.min(DRIVE_CLASS_MAX, Math.floor(driveClass) || 1));
  return DRIVE_CLASS_REACH_MULT[c];
}

// A ship's deep-space reach in light-years on a voyage whose round trip (out plus back, before any detour) takes
// `roundTripSeconds`: the gear-inclusive range x (1 + the Engineering long-haul ramp on that round trip's own hours,
// tick.ts shipTripRangeLightYears) x its drive class multiplier. Pure.
export function expeditionReachLy(state: GameState, ship: ShipInstance, roundTripSeconds: number): number {
  const ticks = state.tickDurationSeconds > 0 ? roundTripSeconds / state.tickDurationSeconds : roundTripSeconds;
  return shipTripRangeLightYears(state, ship, ticks) * driveClassReachMult(shipDriveClass(state, ship));
}

// ===== Frontier sensors (locked I.6; user G7) =====

export const FRONTIER_SENSORS: Readonly<Record<RegionTier, number>> = { 1: 0, 2: 10, 3: 20, 4: 30, 5: 40, 6: 55, 7: 65 };

// The ship's sensors as the dispatch snapshot freezes them (crew-inclusive: expedition.ts shipSensorSnapshot reads the
// same effectiveShipStats). Pure.
export function shipFrontierSensors(state: GameState, ship: ShipInstance): number {
  return effectiveShipStats(state, ship).sensors;
}

// ===== The gates and their reasons =====

// Why a ship cannot attempt a tier (the first unmet, in this order) or a system (then reach).
export type ExpeditionTierGateReason = "notExplorer" | "driveClassUnavailable" | "driveClassTooLow" | "frontierSensors";
export type ExpeditionGateReason = ExpeditionTierGateReason | "outOfReach";

// One refusal with the numbers its text names. `roundTripLy` / `reachLy` only for outOfReach.
export interface ExpeditionGateDetail {
  reason: ExpeditionGateReason;
  tier: RegionTier;
  driveClassNeeded: number;
  driveClass: number;
  sensorsNeeded: number;
  sensors: number;
  roundTripLy?: number;
  reachLy?: number;
}

// Every tier gate, met or not (the opened tab lists them all), and the first unmet one.
export interface ExpeditionTierGates {
  tier: RegionTier;
  explorer: boolean;
  driveClass: number;
  driveClassNeeded: number;
  driveMet: boolean;
  driveBuildable: boolean; // some hull and blueprint can give the needed class today
  sensors: number;
  sensorsNeeded: number;
  sensorsMet: boolean;
  first: ExpeditionGateDetail | null;
}

// The tier gates of `ship` for `tier`: explorer hull, then drive class (unavailable when nothing can give it today,
// else too low), then frontier sensors. Pure.
export function expeditionTierGates(state: GameState, ship: ShipInstance, tier: RegionTier): ExpeditionTierGates {
  const explorer = SHIP_TYPES[ship.typeKey]?.spec === "explorer";
  const driveClass = shipDriveClass(state, ship);
  const driveClassNeeded = tierMinimumDriveClass(tier);
  const driveMet = driveClass >= driveClassNeeded;
  const driveBuildable = buildableDriveClassMax() >= driveClassNeeded;
  const sensors = shipFrontierSensors(state, ship);
  const sensorsNeeded = FRONTIER_SENSORS[tier] ?? 0;
  const sensorsMet = sensors >= sensorsNeeded;
  const base = { tier, driveClassNeeded, driveClass, sensorsNeeded, sensors };
  const reason: ExpeditionTierGateReason | null = !explorer
    ? "notExplorer"
    : !driveMet
      ? driveBuildable
        ? "driveClassTooLow"
        : "driveClassUnavailable"
      : !sensorsMet
        ? "frontierSensors"
        : null;
  return { tier, explorer, driveClass, driveClassNeeded, driveMet, driveBuildable, sensors, sensorsNeeded, sensorsMet, first: reason ? { reason, ...base } : null };
}

// The reach check of one system: `roundTripLy` (2 x its distance from the homeworld) against the ship's reach on that
// voyage. Pure.
export function reachCheck(state: GameState, ship: ShipInstance, distanceLy: number, roundTripSeconds: number): { roundTripLy: number; reachLy: number; met: boolean } {
  const roundTripLy = 2 * distanceLy;
  const reachLy = expeditionReachLy(state, ship, roundTripSeconds);
  return { roundTripLy, reachLy, met: reachLy >= roundTripLy };
}

const lyText = (n: number): string => Math.floor(n).toLocaleString("en-US");
const classText = (n: number): string => `Class ${regionTierNumeral(Math.max(1, Math.min(DRIVE_CLASS_MAX, n)) as RegionTier)}`;

// The player-facing line of a refusal (the signed-off mockup's exact texts, US English). EXHAUSTIVE with no default:
// a new reason is a compile error here until it has text. Pure.
export function expeditionGateText(d: ExpeditionGateDetail): string {
  const region = REGION_TIER_NAMES[d.tier];
  switch (d.reason) {
    case "notExplorer":
      return "This hull cannot reach any expedition system. Expeditions need an explorer hull.";
    case "driveClassUnavailable":
      return `Needs a ${classText(d.driveClassNeeded)} drive. None can be built yet.`;
    case "driveClassTooLow":
      return `Needs a ${classText(d.driveClassNeeded)} drive to reach the ${region}.`;
    case "frontierSensors":
      return `Needs sensors ${d.sensorsNeeded} to chart the ${region} (this ship reads ${Math.floor(d.sensors)}).`;
    case "outOfReach":
      return `Beyond this ship's reach: ${lyText(d.roundTripLy ?? 0)} ly round trip, the ship reaches ${lyText(d.reachLy ?? 0)} ly.`;
  }
}
