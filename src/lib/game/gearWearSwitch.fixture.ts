// GEAR WEAR step 3 (docs/plans/2026-10-16-gear-wear-design.md section 11): the "turn it off" switch the golden tests
// use to prove what the use wear engine moved (the emodEm1Switch / siMemberGearSwitch precedent). TEST-ONLY (imported
// by *.test.ts files only).
//
// Step 3 moves a run's gear in exactly one way: its use wear sources (gearWear.ts WEAR_SOURCES, mode "use") take
// condition off the pieces at the run's events, and from then on the worn-gear view folds the worn lines and the
// pieces recover on their own. With the switch ON (for the duration of one call, restored after, nothing else
// touched) every use source's raw amount is 0, so gearWearEngine.ts gearWearLive() is false: no captain mission or
// expedition is stamped, no event takes anything, every piece stays pristine, the view is the stored state and the
// repair pass has nothing to settle. A run computed inside it is the pre-step-3 run exactly.
//
// The golden files that pinned a run before step 3 run it inside this switch, so their pins keep proving that nothing
// else moved; gearWearGoldens.test.ts pins the wear numbers and proves the switch reproduces its own step 1 capture.

import { afterAll, beforeAll } from "vitest";
import { WEAR_SOURCES } from "./gearWear";

function useSources(): { raw: number }[] {
  return WEAR_SOURCES.filter((s) => s.mode === "use") as { raw: number }[];
}

export function withGearWearOff<T>(run: () => T): T {
  const uses = useSources();
  const saved = uses.map((s) => s.raw);
  try {
    for (const s of uses) s.raw = 0;
    return run();
  } finally {
    uses.forEach((s, i) => (s.raw = saved[i]));
  }
}

// The same switch for a WHOLE golden file (called once at its top level): on before its first test, restored after
// its last. Every golden file captured before step 3 calls it, so its pins keep proving nothing else moved (each test
// file runs in its own module graph, so the switch never reaches another file).
export function gearWearOffInThisFile(): void {
  let saved: number[] = [];
  beforeAll(() => {
    const uses = useSources();
    saved = uses.map((s) => s.raw);
    for (const s of uses) s.raw = 0;
  });
  afterAll(() => {
    useSources().forEach((s, i) => (s.raw = saved[i]));
  });
}
