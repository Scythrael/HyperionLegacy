// TEST-ONLY: the switch-off for the source planet stamp (user 2026-11-13 "First + count", relicBlanks.ts
// RELIC_PLANET_STAMP_SWITCH). The stamp only adds a display name to each blank (`planet`, appended last) and to its
// culture's record (`planets`); it changes no roll and no stat. Golden files captured before it run with it off
// (planetStampOffForThisFile, the ordering2OffForThisFile precedent), so each of their pins is reproduced exactly as
// captured; relicsV2Content.test.ts proves the stamp itself. Never imported by app code.
import { afterAll, beforeAll } from "vitest";
import { RELIC_PLANET_STAMP_SWITCH } from "./relicBlanks";

export function withoutPlanetStamp<T>(fn: () => T): T {
  const was = RELIC_PLANET_STAMP_SWITCH.on;
  RELIC_PLANET_STAMP_SWITCH.on = false;
  try {
    return fn();
  } finally {
    RELIC_PLANET_STAMP_SWITCH.on = was;
  }
}

export function planetStampOffForThisFile(): void {
  let was = true;
  beforeAll(() => {
    was = RELIC_PLANET_STAMP_SWITCH.on;
    RELIC_PLANET_STAMP_SWITCH.on = false;
  });
  afterAll(() => {
    RELIC_PLANET_STAMP_SWITCH.on = was;
  });
}
