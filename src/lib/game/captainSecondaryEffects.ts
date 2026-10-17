// WR-5c (0.14.0): the captain SECONDARY talent tooltip text (the helper WR-5a builds in parallel; this is a
// COMPATIBLE subset with the same exported names and signatures, so the merge keeps WR-5a's file).
//
// MERGE NOTE: when WR-5a's captainSecondaryEffects.ts lands, keep it and make two edits: route the explorer keys to
// captainExplorerEffects.ts explorerTalentText (its secondaryTalentEffectText becomes `prospectorText(key) ??
// explorerTalentText(key) ?? genericText(...)`), and add the `levelLift` case to its magnitude and generic-text
// switches (Foreknowledge). Drop its deepScan / relicHunter / legendaryCaptain taglines (the exact text replaces them).
//
// The readers read each node by its KEY and every magnitude from the catalog (model.ts SECONDARY_CAPTAIN_TALENTS),
// so a retune is a data edit. All PURE.

import {
  SECONDARY_CAPTAIN_TALENTS,
  type CaptainSecondaryTalentEffect,
  type CaptainState,
  type GameState,
  type SecondaryTalentKey,
} from "./model";
import { explorerNodeMagnitude, explorerTalentText } from "./captainExplorerEffects";

// The node's configured magnitude (a statMult's mult, a procChance's chance, a capstone's magnitude, a levelLift's
// levels; 0 for a gateway). Pure.
export function secondaryTalentMagnitude(key: SecondaryTalentKey): number {
  return explorerNodeMagnitude(key);
}

// The captain who commands `ship` (OC-A2), or undefined for an unassigned hull.
export function commandingCaptain(state: GameState, ship: { assignedCaptainId: number | null }): CaptainState | undefined {
  return ship.assignedCaptainId === null ? undefined : state.captains.find((c) => c.id === ship.assignedCaptainId);
}

// The capstone taglines of the trees whose slices (WR-5a, WR-5b) give them their exact text.
const CAPSTONE_TAGLINE: Readonly<Record<string, string>> = {
  motherlode: "Motherlode: a chance for a full double haul",
  overloadedHolds: "Overloaded Holds: carry beyond cargo cap, penalty-free",
  tradeBaron: "Trade Baron: best margins + a passive credit trickle",
  alphaStrike: "Alpha Strike: a bonus-damage opening volley",
  bulwark: "Bulwark: survive one lethal hit per battle",
  wolfpack: "Wolfpack: an extra drone squadron / fleet-wide edge",
};

const humanize = (stat: string): string => stat.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

// The generic line of a node another slice wires (the Prospector and Tactician trees on this branch).
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
    case "levelLift":
      return `+${effect.levels} ${humanize(effect.stat)}`;
  }
}

// One node's player text: exactly what it does. Pure.
export function secondaryTalentEffectText(key: SecondaryTalentKey): string {
  return explorerTalentText(key) ?? genericText(SECONDARY_CAPTAIN_TALENTS[key].effect);
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
