// moduleEffectText.ts: E-MOD EM-7 (0.14.0). What a universal module piece DOES, in the signed-off modules mockup's words
// (Relics, Refinery and Modules mockup, section C, the module details card: what it does, when it acts and, for an
// Active, its one preset rule), at THIS piece's rarity, quality and ascension (model.ts moduleEffectScale, the scale
// every module engine applies). The item card shows these lines under the piece's name; a module carries no stat lines,
// so without them a crafted module would read as nothing.
//
// Every number shown is the one the engine uses: the same rounding (whole power and arc damage points, shield restore
// in per-mille), the same unscaled chance (the scale acts on the effect's size, shipModules.ts MODULE_SCALE_ON).
// Pure presentation, node-testable (no Svelte harness); no game rules live here.

import { moduleEffectScale, shipGearSetBonusLines, type EquipmentInstance } from "../game/model";
import { activeGearSetTiers, gearSetDef } from "../game/gearSets";
import { UNIVERSAL_MODULES, modulePowerOutput, pieceModuleDef, type ModuleContext, type UniversalModuleDef } from "../game/shipModules";
import { CONDITION_FULL, pieceCondition } from "../game/gearWear";

// A fraction as a percent with at most one decimal ("12%", "6.7%").
function pct(f: number): string {
  const v = Math.round(f * 1000) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

// Where a module acts, the mockup's words ("Everywhere", "Combat", "Missions", "Expeditions").
export function moduleContextLabel(def: Pick<UniversalModuleDef, "contexts">): string {
  const has = (c: ModuleContext) => def.contexts.includes(c);
  if (has("patrol") && has("shipEvent") && has("mission") && has("expedition")) return "Everywhere";
  if (def.contexts.every((c) => c === "patrol" || c === "shipEvent")) return "Combat";
  if (def.contexts.every((c) => c === "mission")) return "Missions";
  if (def.contexts.every((c) => c === "expedition")) return "Expeditions";
  return def.contexts.join(", ");
}

const CATEGORY_LABEL: Readonly<Record<UniversalModuleDef["category"], string>> = {
  passive: "Passive",
  proc: "Proc",
  conditional: "Conditional",
  active: "Active",
  set: "Set",
  special: "Special",
};

// "Passive · Everywhere" (the category and where it acts), the mockup's sub-line.
export function moduleKindText(def: UniversalModuleDef): string {
  return `${CATEGORY_LABEL[def.category]} · ${moduleContextLabel(def)}`;
}

// The effect sentence of `def` at effect scale `scale` (1 = Standard quality 0). Pure.
export function moduleEffectSentence(def: UniversalModuleDef, scale: number): string {
  const m = def.effect.magnitude * scale;
  switch (def.effect.key) {
    case "powerOutput":
      return `Adds ${Math.round(m)} power output.`;
    case "hullIntegrity":
      return `+${pct(m)} hull integrity in combat.`;
    case "weaponDamage": {
      const below = def.condition?.fraction ?? 0;
      return `While hull is below ${pct(below)}: +${pct(m)} weapon damage.`;
    }
    case "arcDamage":
      return `When the ship takes a hit: a ${pct(def.chance ?? 0)} chance to arc ${Math.max(0, Math.round(m))} damage back at the attacker.`;
    case "shieldRestore":
      return `Restores ${pct(Math.min(1000, Math.round(m * 1000)) / 1000)} shields.`;
    case "bonusHaul":
      return `Each extraction cycle: a ${pct(def.chance ?? 0)} chance of a bonus haul, +${pct(m)} of that cycle's common material.`;
    case "scanSpeedBonus": {
      // EM-7 review: the set engine scales the pair by the MEAN of both pieces' scales (gearSets.ts), so a lone piece's
      // number is this piece's share of that average, and the card says so.
      const partners = UNIVERSAL_MODULES.filter((d) => d.category === "set" && d.setId === def.setId && d.id !== def.id).map((d) => d.label);
      return `With ${partners.length === 1 ? `a ${partners[0]}` : partners.join(" and ")} installed: +${pct(m)} scan speed on expeditions (the pair's bonus averages both pieces).`;
    }
    case "extraDiscovery":
      return `Each body scanned: a chance to uncover ${Math.round(def.effect.magnitude)} extra hidden discovery.`;
    case "nebulaSweep":
      // GG-7: the Ramscoop Collector, at the engine's own per-mille stamp (gasGiantStudy.ts gearPermilleStamp).
      return `Nebula sweeps: +${pct(Math.round(m * 1000) / 1000)} canisters, and the sweep runs that much faster. Nebulae stay gatherable without it.`;
  }
}

// An Active's one preset rule (user M3, "One preset rule"), or null for any other category. Pure.
export function moduleRuleText(def: UniversalModuleDef): string | null {
  if (def.category !== "active" || def.trigger === undefined) return null;
  const when = def.trigger.kind === "hullBelow" ? `when hull falls below ${pct(def.trigger.fraction)}` : def.trigger.kind === "battleStart" ? "at the start of battle" : "when its trigger fires";
  const how = def.oncePerBattle === true ? "once per battle" : `every ${def.cooldownTicks ?? 0} ticks at most`;
  return `Auto-cast, preset rule: ${how}, ${when}.`;
}

// E-MOD EM-10: WHEN a module acts, its trigger in plain words (the EM-10 "module tooltip with its trigger in plain
// words"; the user's M4 trigger set). Read from the def's own category, trigger, condition and contexts, so a new
// module never needs its own sentence here. Pure.
export function moduleWhenText(def: UniversalModuleDef): string {
  const where = moduleContextLabel(def);
  // GG-7: the Ramscoop Collector acts on one event of a run, its nebula sweep.
  if (def.effect.key === "nebulaSweep") return "Acts on each expedition's nebula sweep.";
  if (def.category === "passive") return where === "Everywhere" ? "Always on, everywhere the ship goes." : `Always on in ${where.toLowerCase()}.`;
  if (def.category === "conditional" && def.condition !== undefined) {
    const pool = def.condition.kind === "hullBelow" ? "hull" : "shields";
    return `Acts in combat while the ship's ${pool} is below ${pct(def.condition.fraction)}.`;
  }
  if (def.category === "set") return "Acts on expeditions while both pieces of its pair are installed on the same ship.";
  if (def.trigger === undefined) return `Acts in ${where.toLowerCase()}.`;
  switch (def.trigger.kind) {
    case "battleStart":
      return "Acts once at the start of each battle.";
    case "incomingAmbush":
      return "Acts when the ship is ambushed, before the ambusher's opening salvo lands.";
    case "afterAmbush":
      return "Acts when the ship is ambushed, right after the opening salvo lands.";
    case "onHit":
      return "Acts each time the ship takes a hit in combat.";
    case "combatTick":
      return "Acts every combat round.";
    case "hullBelow":
      return `Acts in combat once the ship's hull falls below ${pct(def.trigger.fraction)}.`;
    case "missionCycle":
      return "Acts on each delivered extraction cycle of a captain mission.";
    case "bodyScanned":
      return "Acts on each body an expedition scans.";
  }
}

// The card's draw line: "Power draw 8", and for a module that adds power "Power draw 0, adds 8 power". Reads the piece's
// own minted draw and the engine's own output fold for it (shipModules.ts modulePowerOutput, the reader the budget
// uses, so the card and the bar can never round apart). Pure.
export function moduleDrawText(piece: EquipmentInstance): string {
  const adds = modulePowerOutput([piece], (p) => moduleEffectScale(p.rarity, p.quality, p.ascension));
  return adds > 0 ? `Power draw ${piece.powerDraw}, adds ${adds} power` : `Power draw ${piece.powerDraw}`;
}

// The card's condition line (the mockup's details card), or null for a pristine piece. Wear never moves the power checks
// (gear wear design 4.3). Pure.
export function moduleConditionText(piece: Pick<EquipmentInstance, "condition">): string | null {
  const pct = Math.round((pieceCondition(piece) / CONDITION_FULL) * 100);
  if (pct >= 100) return null;
  return `Condition ${pct}%. Wears slowly while the ship is underway; power checks always use the pristine values.`;
}

// The card's closing note (the mockup's details card): the one-per-ship rule (user M8) and the S2 lock.
export const MODULE_CARD_NOTE = "One per ship. Changes wait while the ship is out.";

// The item card's module lines for a piece: its kind, its effect at this piece's scale, an Active's rule, when it acts
// (EM-10) and its power draw. Null for any piece that is not a known universal module. `shipPieces` (the pieces
// installed beside it, when the host knows them): a set piece whose set is complete there shows the set's REAL bonus
// (model.ts shipGearSetBonusLines, the reader the expedition dispatch uses). Pure.
export interface PieceModuleLines {
  kind: string;
  effect: string;
  rule: string | null;
  when: string;
  draw: string;
  condition: string | null;
}
export function pieceModuleLines(piece: EquipmentInstance, shipPieces?: readonly EquipmentInstance[]): PieceModuleLines | null {
  const def = pieceModuleDef(piece);
  if (def === undefined) return null;
  return {
    kind: moduleKindText(def),
    effect: activeSetText(def, piece, shipPieces) ?? moduleEffectSentence(def, moduleEffectScale(piece.rarity, piece.quality, piece.ascension)),
    rule: moduleRuleText(def),
    when: moduleWhenText(def),
    draw: moduleDrawText(piece),
    condition: moduleConditionText(piece),
  };
}

// "Survey Pair active: +8.4% scan speed on expeditions." for a set piece installed with its whole set, else null.
function activeSetText(def: UniversalModuleDef, piece: EquipmentInstance, shipPieces: readonly EquipmentInstance[] | undefined): string | null {
  if (def.category !== "set" || shipPieces === undefined || !shipPieces.some((p) => p.id === piece.id)) return null;
  const set = gearSetDef(def.setId);
  const active = set !== undefined && activeGearSetTiers(shipPieces, set.scope, undefined, (p) => moduleEffectScale(p.rarity, p.quality, p.ascension)).some((t) => t.setId === set.id);
  if (!active) return null;
  const bonus = shipGearSetBonusLines(shipPieces)[def.effect.key] ?? 0;
  return `${set.label} active: +${pct(bonus)} scan speed on expeditions.`;
}
