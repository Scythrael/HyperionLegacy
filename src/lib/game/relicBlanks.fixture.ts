// TEST-ONLY: Relics v2 R2-2's wiring registry additions (wiring/registry.ts AUDIT_ROWS, section H). R2-2 only ADDS
// entries, after every registry pin was taken, so each pin holds them apart (the RX_ADDED_ENTRY_IDS precedent) and
// relicBlanks.test.ts pins them with their statuses. Never imported by app code.

export const R2_2_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>([
  "relic:audit:blankTiers",
  "relic:audit:blankCulture",
  "relic:audit:shortRangeBlanks",
  "relic:audit:completionBlank",
  "relic:audit:generalPick",
]);
