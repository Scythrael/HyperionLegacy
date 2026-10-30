// Complement plan CP-3 (the Ground Ops complement consumers): the wiring registry READ-BACK the registry golden chains
// apply, since their pins were taken before it. TEST-ONLY.
//
// CP-3 flips six entries pending -> live and adds one audit row (wiring/registry.ts):
//   flipped : the four crew keys (Counter-Infiltration, Away-Team Protection, Triage, Prevent a Crew Loss), each
//             pending on CP-3 with the dead-key probe it was read through (none for Counter-Infiltration), and the
//             Security and Medical quarters wings (pending on CP-3 at their "ground" context, measured on the sheet).
//   added   : crew:audit:preventCrewLossInjuriesOnly (a Health cure does not move).
// cp3ReadBack puts each flipped entry's status, contexts and probe back as they stood and drops the added row, so a pin
// taken before CP-3 is reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

const CP_3 = "Complement plan CP-3 (Ground Ops complement consumers: Security, Medical, exclusive pool)";
const pending = (owner: string, contexts?: string[]): WiringEntry["status"] =>
  (contexts ? { kind: "pending", owner, contexts } : { kind: "pending", owner }) as WiringEntry["status"];

export const CP3_ADDED_IDS: ReadonlySet<string> = new Set(["crew:audit:preventCrewLossInjuriesOnly"]);

type Before = { status: WiringEntry["status"]; contexts: string[]; probe: string | undefined };
export const CP3_FLIPPED_BEFORE: Readonly<Record<string, Before>> = {
  "crew:crew.counterInfiltration": { status: pending(CP_3), contexts: [], probe: undefined },
  "crew:crew.awayTeamProtection": { status: pending(CP_3, ["ground"]), contexts: [], probe: "runSecHp" },
  "crew:crew.triage": { status: pending(CP_3, ["ground"]), contexts: [], probe: "runSecHeal" },
  "crew:crew.preventCrewLoss": { status: pending(CP_3, ["medbay"]), contexts: [], probe: "injuryCare" },
  "ship:QUARTERS_MODULES:quartersSecurityWing": { status: pending("CP-3 (the security division's dead keys; its live keys move)", ["ground"]), contexts: ["sheet"], probe: "sheetUnload" },
  "ship:QUARTERS_MODULES:quartersMedicalWing": { status: pending("CP-3 (the medical division's dead keys; its live keys move)", ["ground"]), contexts: ["sheet"], probe: "sheetUnload" },
};
export const CP3_FLIPPED_IDS: ReadonlySet<string> = new Set(Object.keys(CP3_FLIPPED_BEFORE));

export function cp3ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !CP3_ADDED_IDS.has(e.id))
    .map((e) => {
      const before = CP3_FLIPPED_BEFORE[e.id];
      return before ? ({ ...e, status: before.status, contexts: before.contexts, probe: before.probe } as unknown as WiringEntry) : e;
    });
}
