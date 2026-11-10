// Wiring WR-13 (the 0.14.0 audit leftovers, user answers 2026-11-10 and OC-C4): the wiring registry READ-BACK the registry
// golden chains apply, since their pins were taken before it (the wr10ReadBack precedent). TEST-ONLY.
//
// WR-13 changes the registry by REMOVING three rows and FLIPPING seven:
//   removed         : facility:audit:fuelAutoBuy (S4-A02 "Remove it": the old fuel economy is gone),
//                     wear:WEAR_EFFICIENCY:ftlDrive:engineEfficiency (the drive's engine efficiency wear line, "Drop that
//                     line"), facility:audit:itemEquipStats (OC-C4: ItemDef.equipStats, no planned use, deleted);
//   pending -> seam : the six OC-C4 framework hook rows ("Keep tested hooks"); the gear gates and objective hooks rows
//                     also changed their claims (the WR-13 fix round made both claims name what is tested).
// wr13ReadBack puts each removed row back in its place and each flipped row's status (and claim) back as they stood on
// 717bba3. Apply it innermost.

import type { WiringEntry } from "./wiring/registry";

const pending = (owner: string): WiringEntry["status"] => ({ kind: "pending", owner }) as WiringEntry["status"];

export const WR13_FLIPPED_BEFORE: Readonly<Record<string, WiringEntry["status"]>> = {
  "captain:audit:gearGates": pending("WR-4, OC-C4"),
  "facility:audit:requiresResearch": pending("OC-C4"),
  "facility:audit:requiresFacilityLevels": pending("WR-4, OC-C4"),
  "away:audit:objectiveHooks": pending("OC-C4"),
  "salvage:audit:achievementBoost": pending("OC-C4"),
  "salvage:audit:ascension": pending("OC-C4"),
};
export const WR13_FLIPPED_IDS: ReadonlySet<string> = new Set(Object.keys(WR13_FLIPPED_BEFORE));
const CLAIM_BEFORE: Readonly<Record<string, string>> = {
  "captain:audit:gearGates": "Gear gates minCaptainLevel / requiresTalent / captainSpec (no slot sets them)",
  "away:audit:objectiveHooks": "taskChainFollowUp, calmObjective, affix weightFor (no caller)",
};

// The removed rows, each re-inserted right after the row it followed. Built off a sibling of the same kind (an audit row
// of the registry's default shape, or the drive's transit speed wear row), with every field the pins read set as it was.
type Removed = { id: string; after: string; sibling: string; over: Partial<WiringEntry> };
export const WR13_REMOVED: readonly Removed[] = [
  {
    id: "facility:audit:fuelAutoBuy",
    after: "captain:audit:gearGates",
    sibling: "facility:audit:requiresResearch",
    over: {
      system: "facility",
      source: { catalog: "AUDIT", key: "facility:audit:fuelAutoBuy" },
      claim: "The mission fuel budget and credit auto-buy plumbing (FUEL_CREDITS_PER_UNIT, REFUEL_PENALTY_TICKS, refuelDelayTicks): unreachable since 0.13.6 (an infinite fuel budget). (B5's Buy Fuel, tank and refinery are gone, WR-4.)",
      status: pending("S4-A02 (the fuel-economy cleanup: remove or keep, a user call)"),
    },
  },
  {
    id: "facility:audit:itemEquipStats",
    after: "facility:audit:missionControlUnlock",
    sibling: "facility:audit:requiresResearch",
    over: {
      system: "facility",
      source: { catalog: "AUDIT", key: "facility:audit:itemEquipStats" },
      claim: "ItemDef.equipStats (no item fills it)",
      status: pending("WR-4, OC-C4"),
    },
  },
  {
    id: "wear:WEAR_EFFICIENCY:ftlDrive:engineEfficiency",
    after: "wear:WEAR_EFFICIENCY:ftlDrive:transitSpeed",
    sibling: "wear:WEAR_EFFICIENCY:ftlDrive:transitSpeed",
    over: {
      system: "wear",
      source: { catalog: "WEAR_EFFICIENCY", key: "ftlDrive:engineEfficiency" },
      claim: "A worn ftlDrive piece scales its engine efficiency on the gentle wear curve (never below 75%)",
      status: pending("S4-A02 (the fuel-economy cleanup: a run's fuel price is engine efficiency's only run-time reader, unreachable since 0.13.6; reach reads the pristine drive, design 4.3)"),
      probe: undefined,
      contexts: [],
      curve: { kind: "linearAbsolute" },
      direction: "down",
      note: undefined,
    },
  },
];

export function wr13ReadBack(entries: readonly WiringEntry[]): WiringEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e] as const));
  const out: WiringEntry[] = [];
  for (const e of entries) {
    const before = WR13_FLIPPED_BEFORE[e.id];
    const claim = CLAIM_BEFORE[e.id];
    out.push(before ? ({ ...e, status: before, ...(claim !== undefined ? { claim } : {}) } as WiringEntry) : e);
    for (const r of WR13_REMOVED) {
      if (r.after !== e.id) continue;
      const sibling = byId.get(r.sibling);
      if (!sibling) throw new Error(`wr13ReadBack: sibling ${r.sibling} is missing`);
      out.push({ ...sibling, id: r.id, ...r.over } as WiringEntry);
    }
  }
  return out;
}
