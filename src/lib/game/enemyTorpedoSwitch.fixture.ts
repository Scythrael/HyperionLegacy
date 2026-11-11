// WR-8b ENEMY TORPEDOES (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md, the USER ANSWERS 2026-11-10 "Enemy
// torpedoes" bullet): the test-only switch golden files use to prove what WR-8b moved (the wr10Switch precedent).
// TEST-ONLY (imported by *.test.ts files only).
//
// WR-8b moves these things: every new combat rules stamp carries enemyTorpedoes (combat/combatRules.ts), under which a
// patrol wave's Corsair Carriers install the Concussion Torpedo beside their plasma and its Marauders carry one at the
// ramped chance (combat/patrolProfile.ts), and a ship event's vessel carries one at its tier's chance
// (shipScanEvents.ts). With the switch OFF (ENEMY_TORPEDO_SWITCH.stampNewRuns false, for one call or one file, restored
// after) no new stamp carries the field, so every run started inside it is the pre-WR-8b game exactly.

import { afterAll } from "vitest";
import { ENEMY_TORPEDO_SWITCH } from "./combat/combatRules";

export function withEnemyTorpedoesOff<T>(run: () => T): T {
  const was = ENEMY_TORPEDO_SWITCH.stampNewRuns;
  ENEMY_TORPEDO_SWITCH.stampNewRuns = false;
  try {
    return run();
  } finally {
    ENEMY_TORPEDO_SWITCH.stampNewRuns = was;
  }
}

// The other way round (the WR-8b fix round): inside a file that runs with WR-8b off, one call with it ON (the live game:
// every run started inside carries enemy torpedoes), the file's setting restored after.
export function withEnemyTorpedoesOn<T>(run: () => T): T {
  const was = ENEMY_TORPEDO_SWITCH.stampNewRuns;
  ENEMY_TORPEDO_SWITCH.stampNewRuns = true;
  try {
    return run();
  } finally {
    ENEMY_TORPEDO_SWITCH.stampNewRuns = was;
  }
}

// For a golden FILE captured before WR-8b whose pins are about another slice: the whole file runs with WR-8b off, and
// its pins keep proving that slice moved nothing else. Called once at the file's top level, restored after its last test.
export function enemyTorpedoesOffForThisFile(): void {
  const was = ENEMY_TORPEDO_SWITCH.stampNewRuns;
  ENEMY_TORPEDO_SWITCH.stampNewRuns = false;
  afterAll(() => {
    ENEMY_TORPEDO_SWITCH.stampNewRuns = was;
  });
}
