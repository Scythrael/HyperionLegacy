// GEAR WEAR step 4 (docs/plans/2026-10-16-gear-wear-design.md section 11 step 4): the "turn it off" switch the golden
// tests use to prove what the combat half of gear wear moved (the gearWearSwitch / combatRulesSwitch precedent).
// TEST-ONLY (imported by *.test.ts files only).
//
// Step 4 moves a battle in exactly one way: while any BATTLE source (gearWear.ts WEAR_SOURCES, mode "battle") wears, a
// new patrol cycle and a new expedition are stamped (PatrolMissionState.cycleStartCondition, the expedition stamp's
// `battle` and ShipEventBattle.gearWear), a stamped battle fights its frozen gear at its true condition and records the
// wear it took, and the Damage Control Suite's fires wear it. With the switch ON (for one call, or a whole file,
// restored after) every battle source's raw amount is 0, so gearWear.ts battleWearLive() is false: nothing is stamped,
// every battle reads the stored gear (pristine to every combat reader) and no battle or suite fire wears anything. The
// use sources (step 3) are left as they are. A run computed inside it is the pre-step-4 run exactly.

import { afterAll } from "vitest";
import { WEAR_SOURCES } from "./gearWear";

function battleSources(): { raw: number }[] {
  return WEAR_SOURCES.filter((s) => s.mode === "battle") as { raw: number }[];
}

export function withBattleWearOff<T>(run: () => T): T {
  const rows = battleSources();
  const saved = rows.map((s) => s.raw);
  try {
    for (const s of rows) s.raw = 0;
    return run();
  } finally {
    rows.forEach((s, i) => (s.raw = saved[i]));
  }
}

// The same switch for a WHOLE golden file (called once at its top level): on AT ONCE (so the file's describe-time
// computations see it too), restored after its last test (each test file runs in its own module graph, so the switch
// never reaches another file).
export function battleWearOffInThisFile(): void {
  const rows = battleSources();
  const saved = rows.map((s) => s.raw);
  for (const s of rows) s.raw = 0;
  afterAll(() => {
    rows.forEach((s, i) => (s.raw = saved[i]));
  });
}
