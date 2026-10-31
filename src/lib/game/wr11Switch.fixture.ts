// Wiring WR-11 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-11): the test-only switch golden
// files use to prove what WR-11 moved (the PATROL_LEGS_SWITCH / withCp3Off precedent). TEST-ONLY (imported by *.test.ts
// files only).
//
// WR-11 moves these things: a dispatch stamps the site rules (Expedition.siteRules: the PoI relic odds and materials,
// Ocean surface work, the sensor-scaled anomaly and its haul) and the Museum's Science team power on the members
// (Expedition.museumSciencePower); the ship-event profile no longer freezes its two display copies (evasion,
// shieldCapacity); a material salvage stamps its roll rules (the overflow tilt and the logged loot tier); and the two
// dead-end salvage drops carry a sellValue. With the switch OFF (model.ts WR11_SWITCH.live false, for one call or one
// file, restored after) none of the stamps is written and the profile keeps its copies, so every run, salvage and record
// computed inside it is the pre-WR-11 game exactly (the sellValue only acts when something sells the two drops).

import { afterAll } from "vitest";
import { WR11_SWITCH } from "./model";

export function withWr11Off<T>(run: () => T): T {
  const was = WR11_SWITCH.live;
  WR11_SWITCH.live = false;
  try {
    return run();
  } finally {
    WR11_SWITCH.live = was;
  }
}

// For a golden FILE captured before WR-11 whose pins are about another slice: the whole file runs with WR-11 off, and its
// pins keep proving that slice moved nothing else. Called once at the file's top level: off AT ONCE (so describe-time
// computations see it too), restored after its last test.
export function wr11OffForThisFile(): void {
  const was = WR11_SWITCH.live;
  WR11_SWITCH.live = false;
  afterAll(() => {
    WR11_SWITCH.live = was;
  });
}

// WR-11 (OC-I1) deleted MISSIONS.cargoCapacity, a data deletion no switch can undo. A golden that hashed a mission def
// before WR-11 reads it back through this: the def with the deleted field put back in its old place (right after
// extractionRatePerTick, in every def) at the value it carried (WR11_DELETED_CARGO), so the old hash reproduces.
export const WR11_DELETED_CARGO: Readonly<Record<string, number>> = {
  localFuelRun: 90,
  shortOreRun: 90,
  longOreRun: 90,
  salvageWreckage: 90,
  forageFlora: 90,
  surveyMineralAnomaly: 120,
  surveyStellarPhenomena: 120,
  frontierSupplyRun: 120,
  colonySupplyLift: 150,
  cometIceHarvest: 90,
};
export function missionDefWithCargoBack<T extends object>(key: string, def: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) {
    out[k] = v;
    if (k === "extractionRatePerTick") out.cargoCapacity = WR11_DELETED_CARGO[key];
  }
  return out as T;
}
