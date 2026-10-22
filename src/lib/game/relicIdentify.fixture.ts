// TEST-ONLY: Relics v2 R2-3's wiring registry additions (wiring/registry.ts AUDIT_ROWS, section H). R2-3 only ADDS
// entries, after every registry pin was taken, so each pin holds them apart (the R2_2_ADDED_ENTRY_IDS precedent) and
// relicIdentify.test.ts pins them with their statuses. Never imported by app code.

export const R2_3_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "relic:audit:identifyV2",
  "relic:audit:identifyLanes",
  "relic:audit:identifyQueue",
]);
