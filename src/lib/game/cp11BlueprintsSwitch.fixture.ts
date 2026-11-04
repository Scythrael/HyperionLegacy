// TEST-ONLY (Complement CP-11): the crew module and early sensor array blueprints, held apart, so every golden captured
// before CP-11 can prove CP-11 was its only move (the emodEm8Switch.fixture.ts / gasGiantSpecials.fixture.ts precedent).
// CP-11 adds fifteen blueprints (model.ts CREW_MODULE_BLUEPRINTS, spread into BLUEPRINTS after GG-7's): three bridge,
// nine quarters (the Guest Wing included; Elite Quarters is GG-7's) and three sensor arrays. It adds no slot variety, no
// catalog row and no item: every variety it makes was already in EQUIPMENT_SLOTS and its module catalog.
// The keys are listed here by name (not read from CREW_MODULE_BLUEPRINTS) so the switch holds the same set before and
// after the content lands. withoutCp11Content runs `fn` with them taken out of BLUEPRINTS and puts them back exactly
// (key order included) in a finally. Never imported by app code.

import { BLUEPRINTS, resetRefineConsumerCacheForTest, type BlueprintDef } from "./model";

export const CP11_BLUEPRINT_KEYS: ReadonlySet<string> = new Set([
  "balancedCommandBp",
  "focusedCommandBp",
  "flagCommandBp",
  "utilitarianQuartersBp",
  "efficientQuartersBp",
  "securityQuartersBp",
  "engineeringQuartersBp",
  "scienceQuartersBp",
  "medicalQuartersBp",
  "operationsQuartersBp",
  "flightDeckQuartersBp",
  "guestWingBp",
  "wideBeamArrayBp",
  "focusedBeamArrayBp",
  "balancedArrayBp",
]);

export function withoutCp11Keys(keys: readonly string[]): string[] {
  return keys.filter((k) => !CP11_BLUEPRINT_KEYS.has(k));
}

export function withoutCp11Content<T>(fn: () => T): T {
  const savedBps: [string, BlueprintDef][] = Object.entries(BLUEPRINTS);
  try {
    for (const k of CP11_BLUEPRINT_KEYS) delete BLUEPRINTS[k];
    resetRefineConsumerCacheForTest();
    return fn();
  } finally {
    for (const k of Object.keys(BLUEPRINTS)) delete BLUEPRINTS[k];
    for (const [k, bp] of savedBps) BLUEPRINTS[k] = bp;
    resetRefineConsumerCacheForTest();
  }
}
