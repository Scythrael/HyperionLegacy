// E5 Refugee Posts: the wiring registry entries each E5 slice ADDS, held apart by every registry golden so its pin keeps
// proving no existing entry moved (the ML1 / G1 precedent). TEST-ONLY (imported by *.test.ts files only).

// E5-2: the Evacuation template's three rows (registry.ts, the SHORT_RANGE_TEMPLATES loop), all live.
export const E5_2_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "mission:SHORT_RANGE_TEMPLATES:evacuation:rolls",
  "mission:SHORT_RANGE_TEMPLATES:evacuation:work",
  "mission:SHORT_RANGE_TEMPLATES:evacuation:reward",
]);

// E5-4: the sixteen refugee post rows (registry.ts refugeeEntries), all live: each background's matched buff and an
// off-match refugee at each facility.
export const E5_4_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  ...["refiner", "fuelHandler", "dispatcher", "scholar", "machinist", "shipwright", "salvager", "stargazer"].map((b) => `facility:REFUGEE_BACKGROUNDS:${b}`),
  ...["refinery", "fuelStorage", "missionControl", "research", "fabricator", "shipyard", "salvageBay", "subspaceTelescope"].map((f) => `facility:REFUGEE_OFF_MATCH:${f}`),
]);
