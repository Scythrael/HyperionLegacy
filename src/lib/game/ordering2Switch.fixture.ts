// ORDERING DETERMINISM PART 2 (canonicalOrder.ts ORDERING2_SWITCH; docs/plans/2026-10-22-roadmap-and-release-gates.md):
// the test-only switch golden files use to prove what part 2 moved (the orderingSwitch.fixture.ts precedent). TEST-ONLY
// (imported by *.test.ts files only).
//
// Part 2 moves ORDER and nothing else: `inventory` keys are kept in canonical order when a key is added, and a call's
// completion log records its completions by completion tick, then process id. With the switch OFF (for one call or one
// file, restored after) a new inventory key is appended and the log records in process array order, so a golden
// computed inside it is the game before part 2 exactly.

import { afterAll } from "vitest";
import { ORDERING2_SWITCH } from "./canonicalOrder";
import type { GameState } from "./model";

export function withOrdering2Off<T>(run: () => T): T {
  const was = ORDERING2_SWITCH.live;
  ORDERING2_SWITCH.live = false;
  try {
    return run();
  } finally {
    ORDERING2_SWITCH.live = was;
  }
}

// For a golden FILE captured before part 2 whose pins hash a state with an inventory key added out of canonical order,
// or a call that completed processes out of array order (every pin in it proves an earlier slice's move and nothing
// else): the whole file runs with part 2 off, so its pins keep proving their own slice. ordering2Goldens.test.ts pins
// part 2 itself. Called once at the file's top level: off AT ONCE (so describe-time computations see it too), restored
// after its last test.
export function ordering2OffForThisFile(): void {
  const was = ORDERING2_SWITCH.live;
  ORDERING2_SWITCH.live = false;
  afterAll(() => {
    ORDERING2_SWITCH.live = was;
  });
}

// A state with the two orders part 2 owns normalized, every value kept: `inventory` keys in canonical order, and the
// completion log's entries in one fixed order (by their content, the `done-N` ids then renumbered in that order). Both
// sides of the trace read through it, so "normalized on equals normalized off" proves ORDER (and the log's numbering)
// is all part 2 moved. Pure: shallow copies.
export function asOrdering2Normalized(s: GameState): GameState {
  const inventory = Object.fromEntries(Object.keys(s.inventory).sort().map((k) => [k, s.inventory[k]]));
  const keyed = (s.completionLog ?? []).map((e) => ({ e, key: JSON.stringify({ ...e, id: "" }) }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const first = Math.min(...(s.completionLog ?? []).map((e) => Number(e.id.replace(/^done-/, ""))));
  const completionLog = keyed.map(({ e }, i) => ({ ...e, id: `done-${first + i}` }));
  return { ...s, inventory, completionLog };
}
