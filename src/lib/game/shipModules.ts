// E-MOD EM-5 (0.14.0, plan docs/plans/2026-10-17-material-lines-and-emod-plan.md sections 3.3 and 4 EM-5): the
// UNIVERSAL MODULE catalog types and the pure per-piece readers of the `module` ship slot.
//
// Modules are the ACCESSORY layer (H.1, LOCKED 2026-09-23: weapons = weapons, ship systems = armor, modules =
// accessories). A module is a normal EquipmentInstance on the MULTI slot `module` (model.ts EQUIPMENT_SLOTS.module);
// WHICH module it is lives on the instance as `moduleVariant`, a catalog id stamped by generateEquipment, exactly like
// a crew module or a sensor array. Its effect is resolved from this catalog at read time and scaled by the piece's
// rarity and quality (model.ts moduleEffectScale, the crew modules' curve), so a retune of a catalog number reaches
// every module already in a save.
//
// The user's answers this file follows (plan USER ANSWERS 2026-10-17 and 2026-10-19):
//   M1 "Separate counts": SHIP_TYPES[hull].moduleSlots caps the universal modules AND the spec utility together;
//      the bridge, quarters and sensor keep their own slots and are never counted (MODULE_SLOT_SHARING_TYPES).
//   M2 power + all five categories with a small v1 roster: the category types below cover Passive, Proc,
//      Conditional, Active and Set, plus Special (the Precursor Lens, E4d's "first content").
//   M3 one preset rule per Active (its trigger, once per battle or on a cooldown); no editor.
//   M4 the trigger set: battle start, incoming ambush, after ambush, on hit, per combat tick, below a hull threshold;
//      outside combat per mission cycle and per body scanned.
//   M5 unique effects only: no module carries an OC-D12 pod or drone line.
//   M8 one copy of a module per ship (the Precursor Lens included): the duplicateModule refusal.
//   M9 modules wear slowly underway (gearWear.ts module rows).
//
// SLICE OWNERSHIP: EM-5 (this slice) owns the slot, the cap, the refusals, these types and the Passive and
// Conditional engines (the ship sheet's power output, the combat hull pool, the below-threshold damage). EM-6 owns
// the Proc and Active engine (the trigger points, the private salted streams). EM-7 authors the v1 roster and its
// blueprints (and the two-piece Set bonus); EM-8 the Precursor Lens. So the catalog ships EMPTY here, and the module
// slot stays hidden from the player behind UNIVERSAL_MODULES_LIVE until a module can be crafted.
//
// A LEAF MODULE: it imports nothing but types, so model.ts (equipmentStatMods, the power output fold) can read the
// catalog without an import cycle. Pure: no state, no clock, no random draw.

import type { EquipmentInstance, EquipmentSlotType } from "./model";

// ============================================================================
// The switch
// ============================================================================

// UNIVERSAL_MODULES_LIVE: whether the module slot is shown to the player (the Armory's module slots today; the Ship
// Systems Modules row, the Fabricator group and the Logistics family when EM-10 builds them). FALSE until EM-7
// authors the first craftable module (the user's "nothing player-reachable may be inert": an empty slot no player can
// fill must not be shown). The ENGINE is live regardless (the slot, the cap, the refusals, the effect folds), so a
// module piece behaves correctly the moment one exists; only its surfaces wait. EM-7 flips this in the commit that
// adds the first module blueprint.
export const UNIVERSAL_MODULES_LIVE = false;

// ============================================================================
// Catalog types
// ============================================================================

// The five categories H.1 names, plus Special (the Precursor Lens, discovery-gated, its own unique proc).
export type UniversalModuleCategory = "passive" | "proc" | "conditional" | "active" | "set" | "special";

// Where a module acts. "patrol" and "shipEvent" are the two combat contexts (a patrol wave, an expedition ship event);
// "mission" is a captain mission's cycles; "expedition" is a voyage's scans and legs.
export type ModuleContext = "patrol" | "shipEvent" | "mission" | "expedition";
export const MODULE_COMBAT_CONTEXTS: readonly ModuleContext[] = ["patrol", "shipEvent"];

// The bounded trigger taxonomy (user M4, 2026-10-19, "Original proposal"). Read by EM-6's engine at fixed points in
// the step loop (combat) and at the mission cycle / body scan (outside combat). `hullBelow` carries its threshold as
// a fraction of the hull pool.
export type ModuleTrigger =
  | { readonly kind: "battleStart" }
  | { readonly kind: "incomingAmbush" }
  | { readonly kind: "afterAmbush" }
  | { readonly kind: "onHit" }
  | { readonly kind: "combatTick" }
  | { readonly kind: "hullBelow"; readonly fraction: number }
  | { readonly kind: "missionCycle" }
  | { readonly kind: "bodyScanned" };

// A Conditional module's state: the effect holds while the ship's pool is strictly below `fraction` of its maximum.
export interface ModuleCondition {
  readonly kind: "hullBelow" | "shieldBelow";
  readonly fraction: number;
}

// The effect keys an engine reads. EM-5's engines (the ones built here):
//   powerOutput   Passive, flat: adds whole power to the ship's output (the sheet, the install gate, the budget).
//   hullIntegrity Passive, a fraction: lifts the combat hull pool (patrols and ship events).
//   weaponDamage  Conditional, a fraction: lifts every projectile's damage while the condition holds.
// EM-6 (procs, actives), EM-7 (the set bonus) and EM-8 (the Precursor Lens) add their keys WITH their engines;
// MODULE_ENGINE_KEYS below lists what each category can read today, and the catalog test refuses any other.
export type ModuleEffectKey = "powerOutput" | "hullIntegrity" | "weaponDamage";

export interface ModuleEffect {
  readonly key: ModuleEffectKey;
  readonly magnitude: number; // at standard quality 0; scaled by moduleEffectScale(rarity, quality)
}

// One universal module (plan section 3.3). `id` is the module slot's variety key and the stamped moduleVariant.
export interface UniversalModuleDef {
  readonly id: string;
  readonly label: string;
  readonly category: UniversalModuleCategory;
  readonly contexts: readonly ModuleContext[];
  readonly effect: ModuleEffect;
  readonly trigger?: ModuleTrigger; // Proc, Active and Special (EM-6)
  readonly chance?: number; // Proc and Special: the chance per trigger, 0..1
  readonly cooldownTicks?: number; // Proc and Active
  readonly oncePerBattle?: boolean; // Active (M3: one preset rule)
  readonly condition?: ModuleCondition; // Conditional
  readonly setId?: string; // Set: the pieces sharing one id form the set (EM-7)
  readonly powerDraw: number; // the piece's base draw before a rolled reduction (no slot default: SLOT_BASE_PHYSICALS.module is 0)
  readonly source: "craft" | "discovery" | "salvageExclusive";
}

// The v1 roster lands in EM-7 (the eight rows the user approved 2026-10-19, M6 "Approve all") and EM-8 (the Precursor
// Lens). Each entry must also be a variety of EQUIPMENT_SLOTS.module (model.ts) with the same key; shipModules.test.ts
// holds the two lists equal.
export const UNIVERSAL_MODULES: readonly UniversalModuleDef[] = [];

// The effect keys each category's engine reads TODAY. A category absent here has no engine yet (EM-6: proc, active,
// special; EM-7: set), so no catalog entry of that category may exist until its slice adds the engine and the key
// here: the "nothing inert" rule, enforced by validateUniversalModuleDef.
export const MODULE_ENGINE_KEYS: Readonly<Partial<Record<UniversalModuleCategory, readonly ModuleEffectKey[]>>> = {
  passive: ["powerOutput", "hullIntegrity"],
  conditional: ["weaponDamage"],
};

// ============================================================================
// The slot rules
// ============================================================================

// The slots SHIP_TYPES[hull].moduleSlots caps TOGETHER (user M1, 2026-10-17, "Separate counts": "moduleSlots caps only
// the universal modules and spec utility"). The bridge, quarters and sensor keep their own slots and never count.
export const MODULE_SLOT_SHARING_TYPES: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>(["module", "specUtility"]);

// How many of the shared module slots `pieces` fill. Pure.
export function moduleSlotsUsed(pieces: readonly Pick<EquipmentInstance, "slotType">[]): number {
  let n = 0;
  for (const p of pieces) if (MODULE_SLOT_SHARING_TYPES.has(p.slotType)) n++;
  return n;
}

// The refusal texts every install surface renders (Ship Systems, Install on..., the dev panel), in the signed-off
// Modules mockup's words ("No free module slot ... Remove a module first."; "One per ship."). Lower case first word,
// no final period, like every other install reason text.
export function moduleSlotsFullReasonText(): string {
  return "no free module slot (the Spec Utility shares them). Remove a module first";
}
export function duplicateModuleReasonText(): string {
  return "this module is already installed on this ship (one per ship)";
}

// The catalog def of `id`, or undefined (an unknown or retired id). Pure.
export function universalModuleDef(id: string | undefined, catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES): UniversalModuleDef | undefined {
  if (id === undefined) return undefined;
  return catalog.find((d) => d.id === id);
}

// The catalog def a module piece carries (its stamped moduleVariant), or undefined for any other piece or a module
// whose id this build does not know (a stray save keeps its slot and acts as nothing). Pure.
export function pieceModuleDef(
  piece: Pick<EquipmentInstance, "slotType" | "moduleVariant">,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): UniversalModuleDef | undefined {
  if (piece.slotType !== "module") return undefined;
  return universalModuleDef(piece.moduleVariant, catalog);
}

// Is a module of `moduleVariant` already among `pieces` (user M8, 2026-10-19: "One per ship"; the Precursor Lens too)?
// `exceptId` is the piece being installed or swapped out, never counted against itself. Pure.
export function hasModuleOfVariant(
  pieces: readonly Pick<EquipmentInstance, "id" | "slotType" | "moduleVariant">[],
  moduleVariant: string | undefined,
  exceptIds: readonly string[] = [],
): boolean {
  if (moduleVariant === undefined) return false;
  return pieces.some((p) => p.slotType === "module" && p.moduleVariant === moduleVariant && !exceptIds.includes(p.id));
}

// ============================================================================
// The effect readers (scale injected: model.ts moduleEffectScale, so this file stays a leaf)
// ============================================================================

export type ModuleScaleOf = (piece: EquipmentInstance) => number;

// A module piece's effect magnitude: its def's magnitude times its rarity / quality scale. Pure.
export function moduleMagnitude(def: UniversalModuleDef, piece: EquipmentInstance, scaleOf: ModuleScaleOf): number {
  return def.effect.magnitude * scaleOf(piece);
}

// The summed magnitude of every installed PASSIVE module carrying `key`. One copy per ship (M8) and one catalog module
// per engine key (validateUniversalModuleCatalog) mean nothing stacks today; a second module sharing a key must fold
// through the D23 diminishing curve, never a plain sum (the catalog test refuses it until then). Pure.
export function modulePassiveTotal(
  pieces: readonly EquipmentInstance[],
  key: ModuleEffectKey,
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): number {
  let total = 0;
  for (const piece of pieces) {
    const def = pieceModuleDef(piece, catalog);
    if (def === undefined || def.category !== "passive" || def.effect.key !== key) continue;
    total += moduleMagnitude(def, piece, scaleOf);
  }
  return total;
}

// A module's passive power output in whole points (the budget is integer, combat/power.ts): rounded once over the
// ship's total. 0 for a ship with no such module. Pure.
export function modulePowerOutput(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): number {
  const total = modulePassiveTotal(pieces, "powerOutput", scaleOf, catalog);
  return total > 0 ? Math.round(total) : 0;
}

// A Conditional module as combat reads it: the effect while the pool is strictly below the fraction.
export interface ModuleConditionalMod {
  readonly pool: "hull" | "shield";
  readonly fraction: number;
  readonly weaponDamage: number;
}

// Every installed CONDITIONAL module, as combat folds it (bridge.ts). Empty for a ship with none. Pure.
export function moduleConditionals(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): ModuleConditionalMod[] {
  const out: ModuleConditionalMod[] = [];
  for (const piece of pieces) {
    const def = pieceModuleDef(piece, catalog);
    if (def === undefined || def.category !== "conditional" || def.condition === undefined) continue;
    if (def.effect.key !== "weaponDamage") continue;
    out.push({
      pool: def.condition.kind === "hullBelow" ? "hull" : "shield",
      fraction: def.condition.fraction,
      weaponDamage: moduleMagnitude(def, piece, scaleOf),
    });
  }
  return out;
}

// ============================================================================
// Catalog validation (the shape each category needs; EM-7 / EM-8 data is checked against it)
// ============================================================================

// Every problem with one def, empty when it is well-formed for an engine that exists today. Pure.
export function validateUniversalModuleDef(def: UniversalModuleDef): string[] {
  const errors: string[] = [];
  const keys = MODULE_ENGINE_KEYS[def.category];
  if (keys === undefined) errors.push(`${def.id}: no engine reads the ${def.category} category yet`);
  else if (!keys.includes(def.effect.key)) errors.push(`${def.id}: the ${def.category} engine does not read ${def.effect.key}`);
  if (!(def.effect.magnitude > 0) || !Number.isFinite(def.effect.magnitude)) errors.push(`${def.id}: magnitude must be positive`);
  if (!(def.powerDraw >= 0) || !Number.isInteger(def.powerDraw)) errors.push(`${def.id}: powerDraw must be a whole number >= 0`);
  if (def.contexts.length === 0) errors.push(`${def.id}: no context`);
  if (def.category === "conditional") {
    if (def.condition === undefined) errors.push(`${def.id}: a conditional needs a condition`);
    else if (!(def.condition.fraction > 0 && def.condition.fraction < 1)) errors.push(`${def.id}: the condition fraction must be in (0, 1)`);
    if (def.contexts.some((c) => !MODULE_COMBAT_CONTEXTS.includes(c))) errors.push(`${def.id}: a conditional acts in combat only`);
  } else if (def.condition !== undefined) errors.push(`${def.id}: only a conditional carries a condition`);
  if (def.category === "passive" && def.effect.key === "hullIntegrity" && def.contexts.some((c) => !MODULE_COMBAT_CONTEXTS.includes(c))) {
    errors.push(`${def.id}: hull integrity acts in combat only`);
  }
  if (def.category === "passive" && (def.trigger !== undefined || def.chance !== undefined)) errors.push(`${def.id}: a passive has no trigger`);
  return errors;
}

// Every problem with a catalog: each def, unique ids, and no two modules sharing a Passive or Conditional engine key
// (D23: a shared key would stack as a plain sum; it must get a diminishing curve first). Pure.
export function validateUniversalModuleCatalog(catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES): string[] {
  const errors = catalog.flatMap(validateUniversalModuleDef);
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const def of catalog) {
    if (ids.has(def.id)) errors.push(`${def.id}: duplicate id`);
    ids.add(def.id);
    if (def.category === "passive" || def.category === "conditional") {
      const k = `${def.category}:${def.effect.key}`;
      if (keys.has(k)) errors.push(`${def.id}: a second ${k} module needs a diminishing curve first (D23)`);
      keys.add(k);
    }
  }
  return errors;
}
