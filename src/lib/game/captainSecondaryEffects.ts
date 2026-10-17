// The captain SECONDARY talent player text (App.svelte's talent tooltip and the wiring registry's claim read THIS,
// so they agree). WR-5b (0.14.0) created this module for the Tactician tree (captainTacticianEffects.ts holds its
// readers and exact text); WR-5a (the Prospector tree, built in parallel) introduces the same module with the
// Prospector readers and text. MERGE NOTE: keep WR-5a's file and route its text through
// `prospectorText(key) ?? tacticianEffectText(key) ?? genericText(effect)`, dropping the Tactician taglines below.
//
// The Explorer tree (WR-5c) still renders its generic catalog line here.

import { SECONDARY_CAPTAIN_TALENTS, type CaptainSecondaryTalentEffect, type SecondaryTalentKey } from "./model";
import { tacticianEffectText } from "./captainTacticianEffects";

// The not-yet-wired capstones' catalog taglines (their slices replace them with exact text).
const CAPSTONE_TAGLINE: Readonly<Record<string, string>> = {
  motherlode: "Motherlode: a chance for a full double haul",
  overloadedHolds: "Overloaded Holds: carry beyond cargo cap, penalty-free",
  tradeBaron: "Trade Baron: best margins + a passive credit trickle",
  deepScan: "Deep Scan: full-system reveal + a guaranteed rare find",
  relicHunter: "Relic Hunter: a guaranteed relic from an expedition",
  legendaryCaptain: "Legendary Captain: a crew-wide multiplier + officer aura",
};

const humanize = (stat: string): string => stat.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

// The generic line of a not-yet-wired node's effect.
function genericText(effect: CaptainSecondaryTalentEffect): string {
  switch (effect.type) {
    case "none":
      return "No bonus yet (system pending)";
    case "statMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${humanize(effect.stat)}`;
    case "procChance":
      return `${(effect.chance * 100).toFixed(0)}% chance-based bonus (first-pass)`;
    case "capstone":
      return CAPSTONE_TAGLINE[effect.id] ?? "Branch capstone";
  }
}

// One node's player text: exactly what it does where its slice has wired it. Pure.
export function secondaryTalentEffectText(key: SecondaryTalentKey): string {
  return tacticianEffectText(key) ?? genericText(SECONDARY_CAPTAIN_TALENTS[key].effect);
}

// The node whose catalog effect is `effect` (RadialWeb hands the describer the effect object), or undefined.
const KEY_OF_EFFECT = new Map<CaptainSecondaryTalentEffect, SecondaryTalentKey>(
  (Object.keys(SECONDARY_CAPTAIN_TALENTS) as SecondaryTalentKey[]).map((k) => [SECONDARY_CAPTAIN_TALENTS[k].effect, k]),
);
export function secondaryTalentKeyOfEffect(effect: CaptainSecondaryTalentEffect): SecondaryTalentKey | undefined {
  return KEY_OF_EFFECT.get(effect);
}

// The describer App.svelte passes to RadialWeb: the node's exact text (a stray effect gets the generic line).
export function describeSecondaryTalentEffect(effect: CaptainSecondaryTalentEffect): string {
  const key = secondaryTalentKeyOfEffect(effect);
  return key ? secondaryTalentEffectText(key) : genericText(effect);
}
