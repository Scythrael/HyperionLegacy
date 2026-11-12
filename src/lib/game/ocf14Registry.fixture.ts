// OC-F14 (the player-ordered field repair, user answers 2026-11-12): the wiring registry READ-BACK the registry golden
// chains apply, since their pins were taken before it (the ocg1ReadBack precedent). TEST-ONLY.
//
// OC-F14 changes the registry by FLIPPING one row: away:audit:fieldRepairOrder goes pending -> live, with its own probe
// (content:ocf14:fieldRepairOrder), context, curve, magnitude, note and a reworded claim. ocf14ReadBack puts the row back
// exactly as it stood. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

type Shape = Pick<WiringEntry, "status" | "probe" | "contexts" | "direction" | "curve" | "note" | "claim">;

export const OCF14_BEFORE: Readonly<Record<string, Partial<Shape>>> = {
  "away:audit:fieldRepairOrder": {
    probe: undefined,
    contexts: [],
    direction: "up",
    curve: { kind: "linearAbsolute" },
    note: undefined,
    status: { kind: "pending", owner: "WR-10, OC-F14" },
    claim: "Player-ordered field repair (engine only, no UI)",
  },
};

export function ocf14ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (OCF14_BEFORE[e.id] ? ({ ...e, ...OCF14_BEFORE[e.id] } as WiringEntry) : e));
}
