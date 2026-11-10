// OT-UI (0.14.0, the 2026-11-10 Overtime buttons mockup): the registry read-back the earlier registry pins use to prove
// OT-UI's registry move is exactly its own (the gearWearStep5Registry / cp16Registry precedent). TEST-ONLY.
//
// OT-UI moved the registry one way: facility:SPEED_SEAM:overtime stays LIVE on the same probe and contexts, but its
// claim names every kind it is offered on (data studies, the Docks, docking bays and Systems Bay) and its note says the
// strips reach it; its fixture now runs one job of every kind (wiring/probes.ts withRunningJobs). The read-back restores
// the claim and note as they stood, so a pin taken before OT-UI is reproduced exactly. Applied innermost.

import type { WiringEntry } from "./wiring/registry";

export const OTUI_RESTATED_ID = "facility:SPEED_SEAM:overtime";
const OTUI_CLAIM_BEFORE = "Overtime: each step bought speeds a running job by 25% of its normal rate (Shipyard builds and repairs, research, facility upgrades)";
const OTUI_NOTE_BEFORE = "one step from the normal rate: the time left is divided by 1 + 0.25 (the countdown then runs unchanged)";

// One entry as it stood before OT-UI.
export function otUiEntryBack<T extends Pick<WiringEntry, "id">>(e: T): T {
  return e.id === OTUI_RESTATED_ID ? ({ ...e, claim: OTUI_CLAIM_BEFORE, note: OTUI_NOTE_BEFORE } as T) : e;
}

// The whole registry list read back to before OT-UI.
export function otUiReadBack<T extends Pick<WiringEntry, "id">>(entries: readonly T[]): T[] {
  return entries.map(otUiEntryBack);
}
