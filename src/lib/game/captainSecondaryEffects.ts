// WR-5a (0.14.0, plan docs/plans/2026-10-15-wiring-registry-and-audit-plan.md section 4 WR-5a, section 5.A and the
// USER ANSWERS OC-A1 / OC-A2 / OC-A3): the captain SECONDARY talent effect READERS and each node's player text.
//
// The user's rulings:
//   OC-A1 "Multiplier", then (2026-10-17) "Always multiply": EVERY "+X%" node is its own x (1 + X) factor on the
//     value it names, compounding with that value's other bonuses (never added into another sum): the ship stats,
//     the reach (Fuel Discipline multiplies 1 + engineEfficiency), the find chances (withDeepVeins) and the supply
//     run margin (Market Contacts and Premium Goods are two factors).
//   OC-A2 "own ship": a node acts on the ship that captain commands (ship.assignedCaptainId), frozen at dispatch for
//     runs (the logistics4 precedent: a Ground Ops run reads its frozen factors) and per cycle for patrols. Missions
//     read them live, exactly like the officer bonuses on the same ship stat sheet. The user (2026-10-17, "Block
//     buying while out"): captainSecondaryTree.ts refuses a buy while the captain's ship is crew-locked, so a node
//     never changes under a run in flight. Assayer (2026-10-17, "Own ship only") grades only that captain's own
//     deliveries.
//   OC-A3 "Proposed sizes": every capstone has its configured magnitude and no placeholder is left.
//
// The readers read each node by its KEY (never the catalog `stat` label) and every magnitude from the catalog
// (model.ts SECONDARY_CAPTAIN_TALENTS), so a retune is a data edit. All PURE.
//
// WIRED HERE (the Prospector tree): extraction1 to extraction5, logistics1 to logistics3 and logistics5 (logistics4
// is groundOps.ts groundReloadMult, live since D26), trade1 to trade5. The Tactician tree (WR-5b) keeps its readers
// and exact text in captainTacticianEffects.ts, the Explorer tree (WR-5c) in captainExplorerEffects.ts; the text
// lookup below routes through both.

import {
  SECONDARY_CAPTAIN_TALENTS,
  type CaptainSecondaryTalentEffect,
  type CaptainState,
  type GameState,
  type SecondaryTalentKey,
} from "./model";
// WR-5b / WR-5c: the Tactician and Explorer trees' exact text (neither module imports this one, so no cycle).
import { tacticianEffectText } from "./captainTacticianEffects";
import { explorerTalentText } from "./captainExplorerEffects";

// ============================================================================
// Catalog reads
// ============================================================================

function owns(captain: CaptainState | undefined | null, key: SecondaryTalentKey): boolean {
  return captain?.unlockedSecondaryTalents.includes(key) === true;
}

// The node's configured magnitude: a statMult's mult, a procChance's chance, a capstone's magnitude, a trickle's
// perTick, a levelLift's levels, a flatAdd's amount; 0 for a gateway. Pure.
export function secondaryTalentMagnitude(key: SecondaryTalentKey): number {
  const e = SECONDARY_CAPTAIN_TALENTS[key].effect;
  switch (e.type) {
    case "statMult":
      return e.mult;
    case "procChance":
      return e.chance;
    case "capstone":
      return e.magnitude ?? 0;
    case "creditTrickle":
      return e.perTick;
    case "levelLift":
      return e.levels;
    case "flatAdd":
      return e.amount;
    case "none":
      return 0;
  }
}

// The magnitude of `key` when the captain owns it, else 0.
function owned(captain: CaptainState | undefined | null, key: SecondaryTalentKey): number {
  return owns(captain, key) ? secondaryTalentMagnitude(key) : 0;
}

// The captain who commands `ship` (OC-A2), or undefined for an unassigned hull (one copy, in model.ts).
export { commandingCaptain } from "./model";

// ============================================================================
// Extraction and Logistics: the ship stat sheet (crewOverlay.ts applyCaptainOverlay)
// ============================================================================

export interface CaptainShipLifts {
  extractionYield: number; // extraction1 Prospector's Eye: extractionYieldMult x (1 + this)
  extractionSpeed: number; // extraction3 Efficient Haul: extractionSpeedMult x (1 + this)
  cargo: number; // logistics1 Quartermaster: cargoCapacity x (1 + this)
  engineEfficiency: number; // logistics2 Fuel Discipline: (1 + engineEfficiency) x (1 + this), the reach factor
  unloadSpeed: number; // logistics3 Rapid Turnaround: unloadSpeedMult x (1 + this)
  overflow: number; // logistics5 Overloaded Holds: cargo above the hold, unloaded at no extra time
}

export const NO_CAPTAIN_LIFTS: Readonly<CaptainShipLifts> = Object.freeze({
  extractionYield: 0,
  extractionSpeed: 0,
  cargo: 0,
  engineEfficiency: 0,
  unloadSpeed: 0,
  overflow: 0,
});

// The captain's ship-sheet lifts (all 0 without a node). Pure.
export function captainShipLifts(captain: CaptainState | undefined | null): CaptainShipLifts {
  if (!captain || captain.unlockedSecondaryTalents.length === 0) return NO_CAPTAIN_LIFTS;
  return {
    extractionYield: owned(captain, "extraction1"),
    extractionSpeed: owned(captain, "extraction3"),
    cargo: owned(captain, "logistics1"),
    engineEfficiency: owned(captain, "logistics2"),
    unloadSpeed: owned(captain, "logistics3"),
    overflow: owned(captain, "logistics5"),
  };
}

// ============================================================================
// Extraction: the mission rolls (tick.ts economyTick / tickCaptainMission)
// ============================================================================

// extraction2 Deep Veins: its own x (1 + v) factor on the rare AND uncommon chances (the existing rolls, no new draw).
export function captainFindChanceMult(captain: CaptainState | undefined | null): number {
  return owned(captain, "extraction2");
}

// A chance's relative mult `mult` (chance x (1 + mult)) with Deep Veins composed as its own factor:
// (1 + mult)(1 + v) - 1. The mult itself when the captain lacks the node (byte-identical). Pure.
export function withDeepVeins(mult: number, captain: CaptainState | undefined | null): number {
  const v = captainFindChanceMult(captain);
  return v === 0 ? mult : (1 + mult) * (1 + v) - 1;
}

// extraction4 Assayer: the rollQuality bonus of the captain's mission deliveries (draw-count invariant).
export function captainDeliveryQualityBonus(captain: CaptainState | undefined | null): number {
  return owned(captain, "extraction4");
}

// extraction5 Motherlode: the chance per delivered non-transport cycle that its haul doubles.
export function captainMotherlodeChance(captain: CaptainState | undefined | null): number {
  return owned(captain, "extraction5");
}

// The salt of the Motherlode roll's private stream (odd, unique in the repo; salts.test.ts).
export const MOTHERLODE_SALT = 0x6d0e1a3b;

// The Motherlode roll's private stream seed for one delivered cycle: an FNV-1a mix of the captain id and the
// captain's LIFETIME Motherlode cycle count (CaptainState.motherlodeCycles), then the salt. Pure.
export function motherlodeSeed(captainId: number, lifetimeCycle: number): number {
  const key = `${captainId}|motherlode|${lifetimeCycle}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h ^ MOTHERLODE_SALT) >>> 0;
}

// ============================================================================
// Trade: the supply runs and the docked trickle
// ============================================================================

// trade5 Trade Baron: the factor on every Trade 1 to 4 value (1 without it).
function tradeFactor(captain: CaptainState | undefined | null): number {
  return owns(captain, "trade5") ? secondaryTalentMagnitude("trade5") : 1;
}

export interface CaptainTransportTerms {
  marginBonus: number; // trade1 and trade3 (each x Trade Baron), two factors: rewardMargin x (1 + this)
  supplyDiscount: number; // trade2 (x Trade Baron): the supplies cost x (1 - this); the sale value is unchanged
}

// The captain's supply run terms (0 / 0 without a Trade node). "Always multiply": Market Contacts and Premium Goods
// are each their own (1 + x) factor on the margin. Pure.
export function captainTransportTerms(captain: CaptainState | undefined | null): CaptainTransportTerms {
  const f = tradeFactor(captain);
  const a = owned(captain, "trade1") * f;
  const b = owned(captain, "trade3") * f;
  return {
    marginBonus: a === 0 && b === 0 ? 0 : (1 + a) * (1 + b) - 1,
    supplyDiscount: owned(captain, "trade2") * f,
  };
}

// The supply run card's numbers for `captain` (App.svelte): the margin and the purchase cost per unit of cargo the
// engine applies on that captain's runs (tickCaptainMission: margin x (1 + bonus), cost x (1 - discount)). Pure.
export function captainSupplyRunTerms(
  captain: CaptainState | undefined | null,
  def: { rewardMargin?: number; supplyCostPerCargo?: number },
): { margin: number; costPerCargo: number } {
  const t = captainTransportTerms(captain);
  return { margin: (def.rewardMargin ?? 0) * (1 + t.marginBonus), costPerCargo: (def.supplyCostPerCargo ?? 0) * (1 - t.supplyDiscount) };
}

// trade4 Trade Routes [PROVISIONAL]: credits per tick while the captain is DOCKED (no mission and no expedition),
// once the fleet has delivered at least one supply run cycle (an established route). x Trade Baron. Pure.
export function captainDockedCreditsPerTick(state: GameState, captain: CaptainState): number {
  const perTick = owned(captain, "trade4");
  if (perTick === 0) return 0;
  if (captain.mission !== null) return 0;
  if (state.expeditions.some((e) => e.captainId === captain.id)) return 0;
  if (!fleetHasSupplyRoute(state)) return 0;
  return perTick * tradeFactor(captain);
}

// Whether the fleet has delivered a supply run (transport mission) cycle: lifetime completions of a transport key.
export function fleetHasSupplyRoute(state: GameState): boolean {
  const done = state.lifetimeStats.missionsCompleted;
  return SUPPLY_RUN_KEYS.some((k) => done[k] !== undefined && done[k].gt(0));
}

// The supply run (transport) mission keys. Kept as a literal list beside the trade readers so this module needs
// only the talent catalog; captainSecondaryEffects.test.ts proves it equals every MISSIONS transport.
export const SUPPLY_RUN_KEYS: readonly string[] = ["frontierSupplyRun", "colonySupplyLift"];

// ============================================================================
// Player text (App.svelte's talent tooltip and the registry claim read THIS, so they agree)
// ============================================================================

const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

// The Prospector tree's exact text, from the catalog magnitudes.
function prospectorText(key: SecondaryTalentKey): string | null {
  const m = secondaryTalentMagnitude(key);
  switch (key) {
    case "extraction1":
      return `+${pct(m)} extraction yield on missions (every tier, ore runs and surveys)`;
    case "extraction2":
      return `+${pct(m)} rare and uncommon find chance on missions`;
    case "extraction3":
      return `+${pct(m)} extraction speed: a shorter extracting phase, the same haul`;
    case "extraction4":
      return `+${pct(m)} chance for this captain's mission deliveries to climb a quality step`;
    case "extraction5":
      return `Motherlode: ${pct(m)} chance per delivered mission cycle that its haul doubles`;
    case "logistics1":
      return `+${pct(m)} cargo capacity (counts toward mission cargo requirements)`;
    case "logistics2":
      return `+${pct(m)} reach (engine efficiency: farther per trip on the same fuel)`;
    case "logistics3":
      return `+${pct(m)} unload speed (missions and the Ground Ops offload)`;
    case "logistics4":
      return `+${pct(m)} Ground Ops reload speed`;
    case "logistics5":
      return `Overloaded Holds: +${pct(m)} cargo above the hold, unloaded at no extra time`;
    case "trade1":
    case "trade3":
      return `+${pct(m)} supply run profit margin`;
    case "trade2":
      return `-${pct(m)} supply run purchase cost (the sale value is unchanged)`;
    case "trade4":
      return `+${m} credit${m === 1 ? "" : "s"}/tick while docked, once the fleet has run a supply route`;
    case "trade5":
      return `Trade Baron: x${m} every Trade bonus above (margins, purchase cost, docked credits)`;
    default:
      return null;
  }
}

const humanize = (stat: string): string => stat.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

// The generic line of an effect no tree's text covers (every catalog node has exact text since WR-5c; this is the
// fallback for a stray effect object handed to the describer).
function genericText(effect: CaptainSecondaryTalentEffect): string {
  switch (effect.type) {
    case "none":
      return "No bonus yet (system pending)";
    case "statMult":
      return `+${(effect.mult * 100).toFixed(1)}% ${humanize(effect.stat)}`;
    case "procChance":
      return `${(effect.chance * 100).toFixed(0)}% chance-based bonus (first-pass)`;
    case "capstone":
      return "Branch capstone";
    case "creditTrickle":
      return `+${effect.perTick}/tick while docked`;
    case "levelLift":
      return `+${effect.levels} ${humanize(effect.stat)}`;
    case "flatAdd":
      return `+${effect.amount} ${humanize(effect.stat)}`;
  }
}

// One node's player text: exactly what it does. Pure.
export function secondaryTalentEffectText(key: SecondaryTalentKey): string {
  return prospectorText(key) ?? tacticianEffectText(key) ?? explorerTalentText(key) ?? genericText(SECONDARY_CAPTAIN_TALENTS[key].effect);
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
