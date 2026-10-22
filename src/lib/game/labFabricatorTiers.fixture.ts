// OC-15 (the Research Lab and Fabricator tier III to VII rungs): the one switch the golden suites use to prove the
// rungs are the only cause of a move. withPreOc15Tracks runs `fn` with both tracks cut back to their pre-OC-15
// length (Lab 2 rungs, Fabricator 3), restoring them after; OC15_ADDED_ENTRY_IDS names the wiring registry entries
// the new rungs add (one per rung, enumerated by facilityRungEntries), for the registry pins to hold apart.
import { FABRICATOR_FACILITY_KEY, FACILITIES, LAB_FABRICATOR_TIER_RUNGS, RESEARCH_FACILITY_KEY } from "./model";

export const PRE_OC15_LAB_RUNGS = 2;
export const PRE_OC15_FABRICATOR_RUNGS = 3;

export function withPreOc15Tracks<T>(fn: () => T): T {
  const lab = FACILITIES[RESEARCH_FACILITY_KEY];
  const fab = FACILITIES[FABRICATOR_FACILITY_KEY];
  const [labRungs, fabRungs] = [lab.upgrades, fab.upgrades];
  try {
    lab.upgrades = labRungs.slice(0, PRE_OC15_LAB_RUNGS);
    fab.upgrades = fabRungs.slice(0, PRE_OC15_FABRICATOR_RUNGS);
    return fn();
  } finally {
    lab.upgrades = labRungs;
    fab.upgrades = fabRungs;
  }
}

// The registry ids of the added rungs: the Lab's tier III to VII rungs (indexes 2 to 6) and the Fabricator's tier IV
// to VII rungs (indexes 3 to 6; its tier III rung, index 2, is the FIX B rung it always had).
export const OC15_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...LAB_FABRICATOR_TIER_RUNGS.map((r) => `facility:FACILITIES:${RESEARCH_FACILITY_KEY}:${r.tier - 1}`),
  ...LAB_FABRICATOR_TIER_RUNGS.filter((r) => r.tier - 1 >= PRE_OC15_FABRICATOR_RUNGS).map((r) => `facility:FACILITIES:${FABRICATOR_FACILITY_KEY}:${r.tier - 1}`),
]);
