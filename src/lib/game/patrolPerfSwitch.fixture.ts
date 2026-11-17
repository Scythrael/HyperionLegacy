// HOTFIX 0.13.11.4 (catch-up speed): the test-only switch that turns the patrol cycle setup cache off (tick.ts
// PATROL_PERF_SWITCH: the per-cycle setup and the patrol gear view), so a parity test can run the same span both ways
// and compare whole states. TEST-ONLY (imported by *.test.ts files only).

import { PATROL_PERF_SWITCH } from "./tick";

export function withPatrolPerfOff<T>(run: () => T): T {
  const was = PATROL_PERF_SWITCH.live;
  PATROL_PERF_SWITCH.live = false;
  try {
    return run();
  } finally {
    PATROL_PERF_SWITCH.live = was;
  }
}
