// Reactor fuel ladder + Cometary Ice Harvest + reactor tech foundation (0.14.0): the wiring registry entries this
// slice ADDS, for the golden files that pin the registry (shortRangeGoldens.test.ts registryPin, emodGoldens.test.ts
// rowsBack). TEST-ONLY (imported by *.test.ts files only).
//
// The slice adds entries and changes none: the reactor tech tiers' fuel rungs (REACTOR_TECH_TIERS), each Reactor
// Core variety's tech tag (REACTOR_VARIETY_TECH), the hull tier power requirement seam (SHIP_SEAMS
// hullReactorRequirement) and the new mission's per-field rows (MISSIONS cometIceHarvest:<field>). The ids are read off
// the registry by their sources, so a pin with them left out reproduces the pin from before the slice, and
// reactorFuelGoldens.test.ts pins the list itself (ids and statuses) so a stray entry cannot hide in it.

import { WIRING_REGISTRY } from "./wiring/registry";
import { MISSIONS, type MissionKey } from "./model";

// The mission this slice adds, and the catalog's keys before it: the goldens that walk every mission (the reach, gate
// and run pins captured before it) walk these, so they keep proving no earlier mission moved; reactorFuelGoldens
// pins the new mission's own rows.
export const RX_NEW_MISSIONS: readonly MissionKey[] = ["cometIceHarvest"];
export const PRE_RX_MISSION_KEYS: readonly MissionKey[] = (Object.keys(MISSIONS) as MissionKey[]).filter((k) => !RX_NEW_MISSIONS.includes(k));

const RX_CATALOGS: ReadonlySet<string> = new Set(["REACTOR_TECH_TIERS", "REACTOR_VARIETY_TECH"]);

export const RX_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set(
  WIRING_REGISTRY.filter(
    (e) =>
      RX_CATALOGS.has(e.source.catalog) ||
      (e.source.catalog === "SHIP_SEAMS" && e.source.key === "hullReactorRequirement") ||
      (e.source.catalog === "MISSIONS" && e.source.key.startsWith("cometIceHarvest:")),
  ).map((e) => e.id),
);
