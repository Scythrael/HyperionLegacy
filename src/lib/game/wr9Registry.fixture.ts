// Wiring WR-9 (crew and officers beyond the CP slices): the wiring registry READ-BACK the registry golden chains apply,
// since their pins were taken before it. TEST-ONLY.
//
// WR-9 changes the registry two ways (wiring/registry.ts):
//   flipped : the Pilot's Cunning facet (pending the user's call, no probe: now live on the Flight Deck's facet probe at
//             the sheet) and six crew audit rows (pending, no probe: now live with their checks).
//   added   : crew:audit:opsIntegrityOffload and crew:audit:pilotCunningReturn (the two consumers' own checks).
// wr9ReadBack puts each flipped row's status, contexts and probe back as they stood and drops the added rows, so a pin
// taken before WR-9 is reproduced exactly.

import type { WiringEntry } from "./wiring/registry";

const pending = (owner: string): WiringEntry["status"] => ({ kind: "pending", owner }) as WiringEntry["status"];

export const WR9_ADDED_IDS: ReadonlySet<string> = new Set(["crew:audit:opsIntegrityOffload", "crew:audit:pilotCunningReturn"]);

type Before = { status: WiringEntry["status"]; contexts: string[]; probe: string | undefined };
const audit = (owner: string): Before => ({ status: pending(owner), contexts: [], probe: undefined });
export const WR9_FLIPPED_BEFORE: Readonly<Record<string, Before>> = {
  "facet:pilot:cunning": audit("pending user decision (officerStats.ts CUNNING_PENDING_SEATS)"),
  "crew:audit:enlisted": audit("WR-9, OC-E11"),
  "crew:audit:thirdBuff": audit("WR-9, OC-E12"),
  "crew:audit:rapidLoadoutScope": audit("WR-9, OC-E6"),
  "crew:audit:moraleAttrition": audit("WR-9, OC-E7"),
  "crew:audit:commandPresenceExpedition": audit("WR-9, OC-E9"),
};
export const WR9_FLIPPED_IDS: ReadonlySet<string> = new Set(Object.keys(WR9_FLIPPED_BEFORE));

export function wr9ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  return entries
    .filter((e) => !WR9_ADDED_IDS.has(e.id))
    .map((e) => {
      const before = WR9_FLIPPED_BEFORE[e.id];
      return before ? ({ ...e, status: before.status, contexts: before.contexts, probe: before.probe } as unknown as WiringEntry) : e;
    });
}
