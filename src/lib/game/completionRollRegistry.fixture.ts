// Completion tracking, the planet roll (user 2026-11-13 "Planet roll + system badge"): the wiring registry READ-BACK the
// registry golden chains apply, since their pins were taken before it (the relicContentReadBack precedent). TEST-ONLY.
//
// The roll changes the registry by FLIPPING one row: relic:audit:completionBlank pending (G7) -> live, probe
// content:relic:completionRoll (wiring/probes.ts). completionRollReadBack puts it back exactly as it stood. Apply it
// innermost (inside relicContentReadBack).

import type { WiringEntry } from "./wiring/registry";

type Shape = Pick<WiringEntry, "status" | "probe" | "contexts" | "direction" | "curve">;

export const COMPLETION_ROLL_BEFORE: Readonly<Record<string, Partial<Shape>>> = {
  "relic:audit:completionBlank": {
    probe: undefined,
    contexts: [],
    direction: "up",
    curve: { kind: "linearAbsolute" },
    status: { kind: "pending", owner: "G7 (calls the hook when a planet is fully completed)" },
  },
};

export function completionRollReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) => (COMPLETION_ROLL_BEFORE[e.id] ? ({ ...e, ...COMPLETION_ROLL_BEFORE[e.id] } as WiringEntry) : e));
}
