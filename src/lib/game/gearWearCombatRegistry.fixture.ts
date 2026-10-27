// GEAR WEAR step 4 (0.14.0): the registry read-back the earlier registry pins use to prove step 4's registry move is
// exactly its own (the gearWearRegistry / em4ReadBack precedent). TEST-ONLY.
//
// Step 4 moved the registry in four ways, all its own:
//   - every battle source (wear:WEAR_SOURCES, mode "battle") and every combat efficiency consumer (wear:WEAR_EFFICIENCY
//     shields, plating, pods, modules) went LIVE with a probe and contexts;
//   - the Damage Control Suite's fires and lines took their Shipyard and patrol contexts live (the use source
//     specUtility:effectFires and the consumer specUtility:lines lost those out-of-scope rows);
//   - the reactor's power output consumer was re-owned to the user's EM-4 open call (its owner text);
//   - ship:audit:slotDurabilityDefense and ship:audit:podDurability went LIVE (podDurability's claim rewritten).
// The read-back restores every one as step 3 (and EM-4's re-own) left it.

import type { WiringEntry, WiringStatus } from "./wiring/registry";
import { WEAR_EFFICIENCY, WEAR_SOURCES } from "./gearWear";

// The owner and texts as they stood before step 4 (registry.ts GEAR_WEAR_STEP_4 and WEAR_DC_STEP_4, and the reactor
// consumer's owner after EM-4's re-own).
const STEP_4_OWNER = "gear wear step 4 (combat: true-condition pools, battle wear, reactor and FTL from the installed piece)";
const DC_STEP_4 = "the Damage Control Suite's own fires and lines (a post-loss repair it shortens, a patrol wave it patches): gear wear step 4";
const REACTOR_OWNER = `${STEP_4_OWNER}: the reactor's power output is read by the install gate (pristine, design 4.3), the combat power budget and the reactor surplus drive lift (pristine for now, an open call)`;
const POD_CLAIM_BEFORE = "DRONE_POD_BASE_DURABILITY (pods never wear) and QUALITY_DURABILITY_BONUS on non-weapons";
const LINES_NOTE_BEFORE = "a Pathfinder Suite's sensors line (the survey yield, the short-range scan, the expedition's sensor power); every line scales the same way";

const pending = (owner: string): WiringStatus => ({ kind: "pending", owner });

// The rows step 4 flipped pending -> live (their `${id}|${kind}` pins read them back as pending).
export const GW4_FLIPPED_LIVE: ReadonlySet<string> = new Set([
  ...WEAR_SOURCES.filter((w) => w.mode === "battle").map((w) => `wear:WEAR_SOURCES:${w.id}`),
  ...WEAR_EFFICIENCY.filter((c) => c.combat).map((c) => `wear:WEAR_EFFICIENCY:${c.id}`),
  "ship:audit:slotDurabilityDefense",
  "ship:audit:podDurability",
]);

// The rows step 4 changed without a status flip (contexts, out-of-scope rows, owner text, note).
export const GW4_CHANGED: ReadonlySet<string> = new Set([
  "wear:WEAR_SOURCES:specUtility:effectFires",
  "wear:WEAR_EFFICIENCY:specUtility:lines",
  "wear:WEAR_EFFICIENCY:reactorCore:powerOutput",
]);

// One entry as step 3 left it. Every other entry is returned as it is.
export function gw4EntryBack(e: WiringEntry): WiringEntry {
  if (GW4_FLIPPED_LIVE.has(e.id)) {
    const { probe: _p, tolerance: _t, ...rest } = e;
    return { ...rest, status: pending(STEP_4_OWNER), contexts: [], ...(e.id === "ship:audit:podDurability" ? { claim: POD_CLAIM_BEFORE } : {}) } as WiringEntry;
  }
  if (e.id === "wear:WEAR_EFFICIENCY:reactorCore:powerOutput") return { ...e, status: pending(REACTOR_OWNER) };
  if (e.id === "wear:WEAR_SOURCES:specUtility:effectFires") {
    return {
      ...e,
      contexts: e.contexts.filter((c) => c !== "shipyard" && c !== "patrol"),
      outOfScope: [...(e.outOfScope ?? []), { context: "shipyard", reason: DC_STEP_4 }, { context: "patrol", reason: DC_STEP_4 }],
    };
  }
  if (e.id === "wear:WEAR_EFFICIENCY:specUtility:lines") {
    return {
      ...e,
      contexts: e.contexts.filter((c) => c !== "shipyard" && c !== "patrol"),
      outOfScope: [
        { context: "shipyard", reason: DC_STEP_4 },
        { context: "patrol", reason: DC_STEP_4 },
      ],
      note: LINES_NOTE_BEFORE,
    };
  }
  return e;
}

// The whole registry list read back to step 3.
export function gw4ReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries.map((e) => gw4EntryBack(e as unknown as WiringEntry) as unknown as T);
}
