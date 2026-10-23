// E-MOD EM-3 (plan docs/plans/2026-10-17-material-lines-and-emod-plan.md section 4 EM-3): the test-only switch golden
// files use to prove what the combat over-budget penalty moved. TEST-ONLY (imported by *.test.ts files only).
//
// EM-3 moves one thing: a run that starts now on an over-budget ship carries its power supply percent in the combat
// rules stamp (combat/combatRules.ts CombatRulesStamp.powerSupplyPercent), and the battle reads it. With the switch off
// no stamp carries one, which is exactly a run stamped before EM-3 (and the battle reads nothing new), so every golden
// computed inside the switch is the pre-EM-3 game.

import { POWER_SUPPLY_SWITCH } from "./combat/combatRules";

// Run `fn` with no new stamp carrying a power supply (restored afterward, even on a throw).
export function withPowerSupplyOff<T>(fn: () => T): T {
  const was = POWER_SUPPLY_SWITCH.stampNewRuns;
  POWER_SUPPLY_SWITCH.stampNewRuns = false;
  try {
    return fn();
  } finally {
    POWER_SUPPLY_SWITCH.stampNewRuns = was;
  }
}
