// Complement plan CP-12 (the Bridge Module and Crew Quarters install tiles): the wiring registry READ-BACK the registry
// golden chains apply, since their pins were taken before it (the cp5ReadBack / cp11ReadBack precedent). TEST-ONLY.
//
// CP-12 changes the registry one way (wiring/registry.ts):
//   flipped : ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable (pending on CP-12, no probe) is live, measured end to end
//             through the Ships tab's own tile list (a crafted Utilitarian Quarters installed from the Crew Quarters
//             tile adds the berths an empty complement can fill), with its claim and curve stated.
// cp12ReadBack puts the flipped row's claim, status, contexts, probe, curve, direction and note back as they stood, so a
// pin taken before CP-12 is reproduced exactly. Apply it innermost (before cp11ReadBack, which restates the same row).

import type { WiringEntry } from "./wiring/registry";

export const CP12_FLIPPED_ID = "ship:EQUIPMENT_SLOTS:bridge+quarters:obtainable";
export const CP12_BEFORE = {
  claim: "Bridge and quarters modules can be built and installed",
  status: { kind: "pending", owner: "CP-12 (the Bridge Module and Crew Quarters install tiles; CP-11 built every blueprint)" },
  contexts: [] as string[],
  probe: undefined,
  direction: "up",
  curve: { kind: "linearAbsolute" },
  note: undefined,
} as const;

export function cp12ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries.map((e) =>
    e.id === CP12_FLIPPED_ID ? ({ ...e, ...CP12_BEFORE, contexts: [...CP12_BEFORE.contexts], curve: { ...CP12_BEFORE.curve } } as unknown as WiringEntry) : e,
  );
}
