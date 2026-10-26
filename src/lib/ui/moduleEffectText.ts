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
import { UNIVERSAL_MODULES, pieceModuleDef, type ModuleContext, type UniversalModuleDef } from "../game/shipModules";

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
  }
}

// An Active's one preset rule (user M3, "One preset rule"), or null for any other category. Pure.
export function moduleRuleText(def: UniversalModuleDef): string | null {
  if (def.category !== "active" || def.trigger === undefined) return null;
  const when = def.trigger.kind === "hullBelow" ? `when hull falls below ${pct(def.trigger.fraction)}` : def.trigger.kind === "battleStart" ? "at the start of battle" : "when its trigger fires";
  const how = def.oncePerBattle === true ? "once per battle" : `every ${def.cooldownTicks ?? 0} ticks at most`;
  return `Auto-cast, preset rule: ${how}, ${when}.`;
}

// The item card's module lines for a piece: its kind, its effect at this piece's scale, and an Active's rule. Null for
// any piece that is not a known universal module. `shipPieces` (the pieces installed beside it, when the host knows
// them): a set piece whose set is complete there shows the set's REAL bonus (model.ts shipGearSetBonusLines, the
// reader the expedition dispatch uses). Pure.
export function pieceModuleLines(piece: EquipmentInstance, shipPieces?: readonly EquipmentInstance[]): { kind: string; effect: string; rule: string | null } | null {
  const def = pieceModuleDef(piece);
  if (def === undefined) return null;
  return {
    kind: moduleKindText(def),
    effect: activeSetText(def, piece, shipPieces) ?? moduleEffectSentence(def, moduleEffectScale(piece.rarity, piece.quality, piece.ascension)),
    rule: moduleRuleText(def),
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
