// GEAR WEAR step 5 (0.14.0): the registry read-back the earlier registry pins use to prove step 5's registry move is
// exactly its own (the gearWearCombatRegistry / cp16Registry precedent). TEST-ONLY.
//
// Step 5 moved the registry in three ways, all its own:
//   - wear:audit:quickGearRepair is DELETED (user 2026-11-09, Quick Service dropped: "None, always automatic");
//   - wear:audit:gearRepairOvertime went LIVE (claim rewritten, wired through auditRowWiring);
//   - wear:WEAR_EFFICIENCY:reactorCore:powerOutput went LIVE and not applicable (claim rewritten): the user answered
//     the EM-4 open call it was pending on, 2026-11-09 "Stays full (Recommended)", wear never cuts reactor power output.
// (Patrol use wear gave five use sources the `patrol` context; the user removed it, 2026-11-09 "Combat only on
// patrols", so those rows are step 4's again and need no read-back.)
// The read-back restores every one as step 4 left it, the deleted row back in its place.

import type { WiringEntry, WiringStatus } from "./wiring/registry";

// The owner and the claims as they stood before step 5 (registry.ts GEAR_WEAR_STEP_5 and the two audit rows).
const STEP_5_OWNER = "gear wear step 5 (UI: condition bars, the care line, Quick gear repair and Overtime for credits)";
const QUICK_ID = "wear:audit:quickGearRepair";
const QUICK_CLAIM = "Quick gear repair: an optional instant gear repair for credits; the free automatic repair stays the default";
const OVERTIME_ID = "wear:audit:gearRepairOvertime";
const OVERTIME_CLAIM = "Overtime on gear repair: pay credits to speed a ship's gear recovery by a set percent (never doubling, never instant)";

// The reactor consumer row as step 4 / EM-4 left it: pending on the EM-4 open call, the generic consumer claim.
const REACTOR_ID = "wear:WEAR_EFFICIENCY:reactorCore:powerOutput";
const REACTOR_CLAIM = "A worn reactorCore piece scales its power output where something consumes it (never the install gate) on the gentle wear curve (never below 75%)";
const EM4_WORN_OUTPUT_CALL =
  "the user's EM-4 open call (review item 4, material lines plan): the drive lift reads the Reactor Core's PRISTINE output as built ((a) keep pristine; (b) read the worn output); in combat the core's wear acts through its true-condition pool (wear:WEAR_SOURCES:reactorCore:hitsTaken), never a second penalty (user W3)";

const pending = (owner: string): WiringStatus => ({ kind: "pending", owner });

export const GW5_FLIPPED_LIVE: ReadonlySet<string> = new Set([OVERTIME_ID, REACTOR_ID]);
export const GW5_REMOVED_IDS: ReadonlySet<string> = new Set([QUICK_ID]);

// The step 4 shape of a pending audit row with no wiring (registry.ts entry() defaults), read off a live pending row.
function asPendingAudit(e: WiringEntry, id: string, claim: string): WiringEntry {
  const { probe: _p, tolerance: _t, note: _n, ...rest } = e;
  return { ...rest, id, claim, source: { catalog: "AUDIT", key: id }, status: pending(STEP_5_OWNER), contexts: [], direction: "up", curve: { kind: "linearAbsolute" } } as WiringEntry;
}

// One entry as step 4 left it (the overtime row comes back with the deleted Quick Service row before it).
export function gw5EntriesBack(e: WiringEntry): WiringEntry[] {
  if (e.id === OVERTIME_ID) return [asPendingAudit(e, QUICK_ID, QUICK_CLAIM), asPendingAudit(e, OVERTIME_ID, OVERTIME_CLAIM)];
  if (e.id === REACTOR_ID) {
    const { notApplicable: _na, ...rest } = e;
    return [{ ...rest, claim: REACTOR_CLAIM, status: pending(EM4_WORN_OUTPUT_CALL) } as WiringEntry];
  }
  return [e];
}

// One entry as step 4 left it, for the per-entry pins (the deleted row is not reconstructed here).
export function gw5EntryBack(e: WiringEntry): WiringEntry {
  return gw5EntriesBack(e)[gw5EntriesBack(e).length - 1];
}

// The whole registry list read back to step 4.
export function gw5ReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries.flatMap((e) => gw5EntriesBack(e as unknown as WiringEntry) as unknown as T[]);
}
