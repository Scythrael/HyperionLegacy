// WR-8 (docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-8): the "turn it off" switch the golden
// tests use to prove what the combat descriptors moved. TEST-ONLY (imported by *.test.ts files only).
//
// WR-8 moves two things: every run that starts now is stamped with the combat rules (combat/combatRules.ts
// CombatRulesStamp: fights open at range, stance, range and speed act, the weapon traits, pirate armor and evasion,
// carried statuses, the installed reactor and drive), and the craft pools gain eight lines (the six per-family resist
// lines on Hull Plating and Shield Emitters, the two drone pod counter lines). With the switch ON (for the duration
// of one call, restored after, nothing else touched) no run is stamped and the eight lines are out of their pools, so a
// golden computed inside it is the pre-WR-8 game exactly.

import { afterAll, beforeAll } from "vitest";
import { EQUIPMENT_SLOTS } from "./model";
import { DRONE_POD_AFFIX_POOL } from "./itemgen";
import { COMBAT_RULES_SWITCH, EMITTER_RESIST_LINES, PLATING_RESIST_LINES, POD_LINE_REPLENISH, POD_LINE_SMART_REFLECT } from "./combat/combatRules";

// The two pod lines in the pool (Rapid Charge never joined it: WR-8 review, see itemgen.ts DRONE_POD_AFFIX_POOL).
const POD_LINES: readonly string[] = [POD_LINE_REPLENISH, POD_LINE_SMART_REFLECT];

// Remove `keys` from `pool` in place; returns the removed entries with their positions, for the restore.
function pull(pool: { stat: string; weight: number }[], keys: readonly string[]): { at: number; entry: { stat: string; weight: number } }[] {
  const removed: { at: number; entry: { stat: string; weight: number } }[] = [];
  for (let i = 0; i < pool.length; i++) if (keys.includes(pool[i].stat)) removed.push({ at: i, entry: pool[i] });
  for (let i = removed.length - 1; i >= 0; i--) pool.splice(removed[i].at, 1);
  if (removed.length !== keys.length) throw new Error(`withCombatRulesOff: expected ${keys.length} WR-8 lines in a pool, found ${removed.length}`);
  return removed;
}
function put(pool: { stat: string; weight: number }[], removed: { at: number; entry: { stat: string; weight: number } }[]): void {
  for (const r of removed) pool.splice(r.at, 0, r.entry);
}

// Switch the rules off; returns the restore. Nested calls are refused (the pools would be pulled twice).
function switchOff(): () => void {
  if (!COMBAT_RULES_SWITCH.stampNewRuns) throw new Error("withCombatRulesOff: the combat rules are already switched off");
  const plating = EQUIPMENT_SLOTS.hullPlating.affixPool as { stat: string; weight: number }[];
  const emitter = EQUIPMENT_SLOTS.shieldEmitters.affixPool as { stat: string; weight: number }[];
  const p = pull(plating, PLATING_RESIST_LINES);
  const e = pull(emitter, EMITTER_RESIST_LINES);
  const d = pull(DRONE_POD_AFFIX_POOL, POD_LINES);
  COMBAT_RULES_SWITCH.stampNewRuns = false;
  return () => {
    COMBAT_RULES_SWITCH.stampNewRuns = true;
    put(plating, p);
    put(emitter, e);
    put(DRONE_POD_AFFIX_POOL, d);
  };
}

export function withCombatRulesOff<T>(run: () => T): T {
  const restore = switchOff();
  try {
    return run();
  } finally {
    restore();
  }
}

// For a golden FILE captured before WR-8 (every pin in it proves an earlier slice's move and nothing else): the whole
// file runs with the rules switched off (vitest isolates each test file's modules, so no other file sees it), and its
// pins keep proving that WR-8 moved nothing else there. combatDescriptorGoldens.test.ts pins the combat rules.
export function combatRulesOffForThisFile(): void {
  let restore: (() => void) | undefined;
  beforeAll(() => {
    restore = switchOff();
  });
  afterAll(() => {
    restore?.();
  });
}
