// GEAR WEAR step 3 (0.14.0): the registry read-back the earlier registry pins use to prove step 3's registry move is
// exactly its own (the siMemberGearRegistry / ml2RecipeGoldens fixture precedent). TEST-ONLY.
//
// Step 3 moved the registry in four ways, all its own:
//   - every `wear:` entry it owns went LIVE (the use sources, the repair contexts and bonuses, the non-combat
//     efficiency consumers) with a probe and contexts; two consumers were re-owned (the FTL drive's engine efficiency
//     to S4-A02, the reactor's power output to step 4);
//   - ship:audit:slotDurability went LIVE (toughness scales use wear) with its probe;
//   - ship:audit:slotDurabilityDefense was ADDED (the defense pieces' toughness, step 4);
//   - away:audit:memberSlotPhysicals was re-owned to WR-8 alone (its durability is live).
// The read-back restores every one as step 2 left it (pending, no probe, no contexts) and leaves the added row out.

import type { WiringEntry, WiringStatus } from "./wiring/registry";
import { WEAR_EFFICIENCY, WEAR_SOURCES } from "./gearWear";

// The owners step 2 named (registry.ts GEAR_WEAR_STEP_3 / GEAR_WEAR_STEP_4 as they stood).
const STEP_3_OWNER = "gear wear step 3 (use wear sources, repair contexts and settling at events)";
const STEP_4_OWNER = "gear wear step 4 (combat: true-condition pools, battle wear, reactor and FTL from the installed piece)";

export const GW3_ADDED_IDS: ReadonlySet<string> = new Set(["ship:audit:slotDurabilityDefense"]);

// Each step 3 row's status as step 2 left it.
const STEP_2_STATUS: ReadonlyMap<string, WiringStatus> = new Map<string, WiringStatus>([
  ...WEAR_SOURCES.map((w) => [`wear:WEAR_SOURCES:${w.id}`, { kind: "pending", owner: w.mode === "use" ? STEP_3_OWNER : STEP_4_OWNER }] as [string, WiringStatus]),
  ...(["home", "shipyardBay", "fieldRepair", "underway"] as const).map((c) => [`wear:REPAIR_RATES:${c}`, { kind: "pending", owner: STEP_3_OWNER }] as [string, WiringStatus]),
  ...(["officerRepairSpeed", "damageControlRepairTime"] as const).map((b) => [`wear:REPAIR_RATE_BONUSES:${b}`, { kind: "pending", owner: STEP_3_OWNER }] as [string, WiringStatus]),
  ...WEAR_EFFICIENCY.map((c) => [`wear:WEAR_EFFICIENCY:${c.id}`, { kind: "pending", owner: c.combat ? STEP_4_OWNER : STEP_3_OWNER }] as [string, WiringStatus]),
  ["ship:audit:slotDurability", { kind: "pending", owner: STEP_3_OWNER }],
  ["away:audit:memberSlotPhysicals", { kind: "pending", owner: `WR-8, OC-D14 (durability: ${STEP_3_OWNER})` }],
]);

// The ids step 3 flipped pending -> live (the `${id}|${kind}` pins read them back as pending).
export const GW3_FLIPPED_LIVE: ReadonlySet<string> = new Set([...STEP_2_STATUS.keys()]);

// One entry as step 2 left it, or null for a row step 3 added. Every other entry is returned as it is.
export function gw3EntryBack(e: WiringEntry): WiringEntry | null {
  if (GW3_ADDED_IDS.has(e.id)) return null;
  const status = STEP_2_STATUS.get(e.id);
  if (!status) return e;
  const { probe: _p, ...rest } = e;
  return { ...rest, status, contexts: [] } as WiringEntry;
}

// The whole registry list read back to step 2.
export function gw3RegistryBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map(gw3EntryBack).filter((e): e is WiringEntry => e !== null);
}
