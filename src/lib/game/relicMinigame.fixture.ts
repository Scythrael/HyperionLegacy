// TEST-ONLY: Relics v2 R2-10's wiring registry additions (wiring/registry.ts AUDIT_ROWS, the minigame relic boosts).
// R2-10 only ADDS entries, after every registry pin was taken, so each pin holds them apart (the R2-2 precedent) and
// relicBoosts.test.ts pins them live. Never imported by app code.
import { RELIC_BOOSTS } from "../secret/config";

export const R2_10_ADDED_ENTRY_IDS: ReadonlySet<string> = new Set<string>(RELIC_BOOSTS.map((d) => `relic:audit:minigame:${d.lever}`));
