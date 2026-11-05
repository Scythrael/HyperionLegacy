// Complement CP-14 (hull base sensors and Science amplification): the wiring registry READ-BACK the registry golden
// chains apply, since their pins were taken before it (the cp12ReadBack / cp13ReadBack precedent). TEST-ONLY.
//
// CP-14 changes the registry two ways (wiring/registry.ts):
//   added   : a row per hull that carries base sensors (ship:SHIP_TYPES:<hull>:baseSensors), the Science crew and Science
//             seat rows (ship:SHIP_SEAMS:scienceCrewSensors, ship:SHIP_SEAMS:scienceSeatSensors) and one audit row
//             (ship:audit:scienceSeatFocusedCommand), all live.
//   flipped : ship:SHIP_TYPES:sensors (pending on CP-14, no probe) is live, measured where every run reads sensors.
//   moved   : expedition:audit:frontierSensors reads Tier III's gate (tierThreeSensorsMet): every explorer's base sensors
//             now clear Tier II's, which its old probe (tierTwoLaunchAllowed) read. The fix round (user 2026-11-04 "Retire
//             the dead gates") retired that Tier II gate, so its claim no longer lists II 10.
// cp14ReadBack takes the added rows out and puts the flipped and moved rows back as they stood. Apply it innermost.

import { WIRING_REGISTRY, type WiringEntry } from "./wiring/registry";

const isCp14Row = (id: string): boolean =>
  /^ship:SHIP_TYPES:[A-Za-z]+:baseSensors$/.test(id) ||
  id === "ship:SHIP_SEAMS:scienceCrewSensors" ||
  id === "ship:SHIP_SEAMS:scienceSeatSensors" ||
  id === "ship:audit:scienceSeatFocusedCommand";
export const CP14_ADDED_IDS: ReadonlySet<string> = new Set(WIRING_REGISTRY.map((e) => e.id).filter(isCp14Row));

export const CP14_FLIPPED_ID = "ship:SHIP_TYPES:sensors";
export const CP14_BEFORE = {
  claim: "Explorer hulls carry a sensor advantage (no field exists; MISSING)",
  status: { kind: "pending", owner: "CP-14 (hull base sensors, S4-B04)" },
  contexts: [] as string[],
  probe: undefined,
  direction: "up",
  curve: { kind: "linearAbsolute" },
  note: undefined,
} as const;

export const CP14_MOVED_PROBE_ID = "expedition:audit:frontierSensors";
export const CP14_MOVED_PROBE_BEFORE = "tierTwoLaunchAllowed";
export const CP14_MOVED_CLAIM_BEFORE = "Frontier sensors to attempt a tier: FRONTIER_SENSORS I 0, II 10, III 20, IV 30, V 40, VI 55, VII 65 (frontierSensors)";

export function cp14ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !isCp14Row(e.id))
    .map((e) => {
      if (e.id === CP14_FLIPPED_ID) return { ...e, ...CP14_BEFORE, contexts: [...CP14_BEFORE.contexts], curve: { ...CP14_BEFORE.curve } } as unknown as WiringEntry;
      if (e.id === CP14_MOVED_PROBE_ID) return { ...e, probe: CP14_MOVED_PROBE_BEFORE, claim: CP14_MOVED_CLAIM_BEFORE } as WiringEntry;
      return e;
    });
}
