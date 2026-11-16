// PATROL CATCH-UP PERFORMANCE (0.14.0 release blocker): the test-only switch that turns the patrol optimizations off
// (tick.ts PATROL_PERF_SWITCH: the lazy relaunch inputs, the probe projections, the per-cycle setup reuse), so a parity
// test can run the same span both ways and compare whole states. TEST-ONLY (imported by *.test.ts files only).

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
