// ORDERING DETERMINISM slice (canonicalOrder.ts; docs/plans/2026-10-22-roadmap-and-release-gates.md): the test-only switch
// golden files use to prove what the slice moved (the cp16Switch.fixture.ts precedent). TEST-ONLY (imported by *.test.ts
// files only).
//
// The slice moves ORDER and nothing else: the codex's `discovered` list and the key order of the four lifetime tally maps
// (itemsGathered, itemsRefined, itemsCrafted, missionsCompleted) are kept in canonical order when an entry is added. With
// the switch OFF (canonicalOrder.ts CANONICAL_ORDER_SWITCH.live false, for one call or one file, restored after) an entry
// is appended in the order a call meets it, so a golden computed inside it is the game before the slice exactly.

import { afterAll } from "vitest";
import { CANONICAL_ORDER_SWITCH } from "./canonicalOrder";
import type { GameState } from "./model";

export function withCanonicalOrderOff<T>(run: () => T): T {
  const was = CANONICAL_ORDER_SWITCH.live;
  CANONICAL_ORDER_SWITCH.live = false;
  try {
    return run();
  } finally {
    CANONICAL_ORDER_SWITCH.live = was;
  }
}

// The slice ON for one computation (restored after), for a strict parity check inside a file that runs with it off.
export function withCanonicalOrderOn<T>(run: () => T): T {
  const was = CANONICAL_ORDER_SWITCH.live;
  CANONICAL_ORDER_SWITCH.live = true;
  try {
    return run();
  } finally {
    CANONICAL_ORDER_SWITCH.live = was;
  }
}

// For a golden FILE captured before the slice whose pins hash a state with two or more finds or tally keys met out of
// canonical order (every pin in it proves an earlier slice's move and nothing else): the whole file runs with the slice
// off, so its pins keep proving their own slice. orderingGoldens.test.ts pins the slice itself. Called once at the
// file's top level: off AT ONCE (so describe-time computations see it too), restored after its last test.
export function canonicalOrderOffForThisFile(): void {
  const was = CANONICAL_ORDER_SWITCH.live;
  CANONICAL_ORDER_SWITCH.live = false;
  afterAll(() => {
    CANONICAL_ORDER_SWITCH.live = was;
  });
}

// A state with `discovered` and the four tally maps put in canonical order, every value kept: what the slice makes of a
// state the game before it wrote, so a golden taken with the switch off and passed through this equals the slice's own
// (the proof that ORDER is all it moved). Pure: shallow copies.
export function asCanonicalOrder(s: GameState): GameState {
  const keyed = <T,>(m: Record<string, T>): Record<string, T> => Object.fromEntries(Object.keys(m).sort().map((k) => [k, m[k]]));
  return {
    ...s,
    discovered: [...s.discovered].sort(),
    lifetimeStats: {
      ...s.lifetimeStats,
      itemsGathered: keyed(s.lifetimeStats.itemsGathered),
      itemsRefined: keyed(s.lifetimeStats.itemsRefined),
      itemsCrafted: keyed(s.lifetimeStats.itemsCrafted),
      missionsCompleted: keyed(s.lifetimeStats.missionsCompleted),
    },
  };
}
