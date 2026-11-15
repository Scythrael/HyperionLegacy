// WELCOME BATCH (staging freeze 2026-11-14; transports.ts TRANSPORT_WELCOME_SWITCH; user 2026-11-13 "A welcome batch to
// fill the fleet"): the test-only switch golden files use to prove what the welcome batch moved (the
// homeworldReserveSwitch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts files only).
//
// With the switch OFF a marker far behind (or the pre-crew TRANSPORT_WELCOME_PENDING) delivers its whole backlog: the game
// before the welcome batch exactly. Golden files that BUILD a deep crew pool from a long backlog (one resolveCrew call
// over weeks of game time, a fixture shortcut no live or offline catch-up can produce) run with it off, so their pins keep
// proving their own slice. transportWelcome.test.ts pins the welcome itself.

import { afterAll } from "vitest";
import { TRANSPORT_WELCOME_SWITCH } from "./transports";

export function withTransportWelcomeOff<T>(run: () => T): T {
  const was = TRANSPORT_WELCOME_SWITCH.live;
  TRANSPORT_WELCOME_SWITCH.live = false;
  try {
    return run();
  } finally {
    TRANSPORT_WELCOME_SWITCH.live = was;
  }
}

// Called once at a golden file's top level: off AT ONCE (so describe-time computations see it too), restored after its
// last test.
export function transportWelcomeOffForThisFile(): void {
  const was = TRANSPORT_WELCOME_SWITCH.live;
  TRANSPORT_WELCOME_SWITCH.live = false;
  afterAll(() => {
    TRANSPORT_WELCOME_SWITCH.live = was;
  });
}
