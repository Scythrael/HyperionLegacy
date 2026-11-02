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
// SLICE OWNERSHIP: EM-5 owns the slot, the cap, the refusals, these types and the Passive and Conditional engines
// (the ship sheet's power output, the combat hull pool, the below-threshold damage). EM-6 owns the Proc and Active
// engine: the trigger rules, the frozen proc shapes and their private salted streams below, read at fixed points by
// combat/resolveBattle.ts (the six combat triggers), tick.ts tickCaptainMission (the mission cycle) and expedition.ts
// assignDiscoveriesAndActivities (the body scan). EM-7 authors the v1 roster below and its blueprints (model.ts
// MODULE_BLUEPRINTS), the Set engine (the Survey Pair, a set of the shared gear set engine, gearSets.ts) and flips
// UNIVERSAL_MODULES_LIVE; EM-8 adds the Precursor Lens (the Special, its blueprint model.ts precursorLensBp).
//
// A LEAF MODULE: it imports nothing but types and the leaf specialBlueprints.ts (GG-7), so model.ts (equipmentStatMods,
// the power output fold) and the combat sim can read the catalog without an import cycle. Pure: no state, no clock; the only random draws are on the
// private streams the engine hands in (rollModuleChance).

import type { EquipmentInstance, EquipmentSlotType } from "./model";
import type { Rng } from "./combat/rng";
import { GG7_NUMBERS, RAMSCOOP_COLLECTOR_MODULE } from "./specialBlueprints";

// ============================================================================
// The switch
// ============================================================================

// UNIVERSAL_MODULES_LIVE: whether the module slot is shown to the player (the Armory's module slots, and since EM-10 the
// Ship Systems Modules row, the Fabricator "Modules" group and the Logistics "Modules" family). It was FALSE until EM-7
// authored the first craftable module (the user's "nothing player-reachable may be inert": an empty slot no player can
// fill must not be shown). EM-7 (0.14.0) flipped it with the v1 roster and its blueprints (model.ts MODULE_BLUEPRINTS);
// shipModules.test.ts holds the switch equal to "a module blueprint exists".
export const UNIVERSAL_MODULES_LIVE = true;

// ============================================================================
// Catalog types
// ============================================================================

// The five categories H.1 names, plus Special (the Precursor Lens, discovery-gated, its own unique proc).
export type UniversalModuleCategory = "passive" | "proc" | "conditional" | "active" | "set" | "special";

// Where a module acts. "patrol" and "shipEvent" are the two combat contexts (a patrol wave, an expedition ship event);
// "mission" is a captain mission's cycles; "expedition" is a voyage's scans and legs.
export type ModuleContext = "patrol" | "shipEvent" | "mission" | "expedition";
export const MODULE_CONTEXTS: readonly ModuleContext[] = ["patrol", "shipEvent", "mission", "expedition"];
// The two combat contexts a combatant is built for (bridge.ts shipToCombatant's moduleContext).
export type ModuleCombatContext = "patrol" | "shipEvent";
export const MODULE_COMBAT_CONTEXTS: readonly ModuleCombatContext[] = ["patrol", "shipEvent"];

// Does `def` act in `context`? A module acts ONLY in the contexts it lists (a patrol-only module never acts in a ship
// event). Pure.
export function moduleActsIn(def: UniversalModuleDef, context: ModuleContext): boolean {
  return def.contexts.includes(context);
}

// Does `def` act EVERYWHERE? A ship-sheet effect (the power output: the sheet, the install gate and the budget have no
// context) acts only when the module lists every context, so a narrower module never lifts a context it does not name
// (validateUniversalModuleDef refuses a narrower power module). Pure.
export function moduleActsEverywhere(def: UniversalModuleDef): boolean {
  return MODULE_CONTEXTS.every((c) => def.contexts.includes(c));
}

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

// The effect keys an engine reads. EM-5's engines:
//   powerOutput   Passive, flat: adds whole power to the ship's output (the sheet, the install gate, the budget).
//   hullIntegrity Passive, a fraction: lifts the combat hull pool (patrols and ship events).
//   weaponDamage  Conditional, a fraction: lifts every projectile's damage while the condition holds.
// EM-6's engines (Proc, Active and Special; each fires from its trigger, see MODULE_TRIGGER_EFFECTS):
//   arcDamage      combat, whole damage points: one EW-family hit on the attacker that struck the ship (on hit) or on
//                  the ship's current target (every other combat trigger), through the shared mitigation pipeline.
//   shieldRestore  combat, a fraction of the ship's shield pool restored at once (never above the pool).
//   bonusHaul      mission cycle, a fraction: the delivered cycle's common material grows by that share.
//   extraDiscovery body scanned, whole discoveries: that many more discoveries on the scanned body (the sensor ghost's
//                  draw: a pool, then a site). Its rarity and quality scale act on the CHANCE (MODULE_SCALE_ON).
// EM-7's engine (the Set; its bonus is the set's tier in gearSets.ts GEAR_SETS, the ONE set engine for gear and modules,
// RR-6):
//   scanSpeedBonus expedition, a fraction: added to the run's scan speed bonus at dispatch (the scan rate x (1 + it)),
//                  while the set is complete. A set module's own magnitude IS its set tier's bonus (the catalog test
//                  holds the two equal), so the module reads what the set gives.
// Gas Giant Study GG-7's engine (a Passive read at the expedition dispatch, frozen on the run's nebula stamp):
//   nebulaSweep    expedition, a fraction: the nebula sweep's canisters x (1 + it) and its length / (1 + it) (the Ramscoop
//                  Collector, user call 11: it BOOSTS the sweep, never gates it; a ship without one sweeps as before).
// MODULE_ENGINE_KEYS below lists what each category can read today, and the catalog test refuses any other.
export type ModuleEffectKey =
  | "powerOutput"
  | "hullIntegrity"
  | "weaponDamage"
  | "arcDamage"
  | "shieldRestore"
  | "bonusHaul"
  | "extraDiscovery"
  | "scanSpeedBonus"
  | "nebulaSweep";

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

// ============================================================================
// EM-7: the v1 roster (user M6, 2026-10-19, "Approve all": the eight rows of plan section 5 call 12, as named, with
// those effects; the Precursor Lens, the ninth, is EM-8's, below them)
// ============================================================================

// The Survey Pair's set id (gearSets.ts GEAR_SETS reads it, so the set and its two modules share one key).
export const SURVEY_PAIR_SET_ID = "surveyPair";

// [PROVISIONAL] every number of the v1 roster, in ONE place (no answer names them; the signed-off modules mockup's
// sample values, "illustrative, nothing is final", are the first pass). Magnitudes are at Standard quality 0 and scale
// with the piece's rarity, quality and ascension (model.ts moduleEffectScale; a set's bonus by the mean scale of its
// counted pieces, gearSets.ts). Draws are the piece's base power draw (no slot default).
export const MODULE_V1_NUMBERS = {
  auxiliaryCapacitor: { powerOutput: 8, powerDraw: 0 },
  structuralBracing: { hullIntegrity: 0.06, powerDraw: 3 },
  // "a small hit back": whole EW damage points (a crafted weapon's shot is 20 to 55).
  arcDischarger: { chance: 0.15, arcDamage: 8, powerDraw: 8 },
  // a landed echo adds half the cycle's common haul again (expected +5% at the 10% chance).
  prospectorsEcho: { chance: 0.1, bonusHaul: 0.5, powerDraw: 4 },
  lastStandProtocol: { hullBelow: 0.25, weaponDamage: 0.12, powerDraw: 4 },
  shieldSurge: { hullBelow: 0.5, shieldRestore: 0.3, powerDraw: 6 },
  // the Survey Pair together: +8% scan speed on expeditions.
  surveyPair: { scanSpeedBonus: 0.08 },
  longBaselineArray: { powerDraw: 6 },
  signalIntegrator: { powerDraw: 5 },
} as const;

// E-MOD EM-8: the Precursor Lens (the ninth row of call M6). Its catalog id (the module slot's variety key and the
// piece's stamped moduleVariant) shares the relic's id: the relic opens it, the module carries its name.
export const PRECURSOR_LENS_MODULE = "precursorLens";
// [PROVISIONAL] (no answer names a number): the chance per body scanned at Standard quality 0 (the piece's rarity and
// quality lift it, MODULE_SCALE_ON), the discoveries a landed roll adds (one: the M6 row's "one extra hidden
// discovery") and the power draw (9: the signed-off modules mockup's sample, section C).
export const PRECURSOR_LENS_NUMBERS = { chance: 0.2, extraDiscovery: 1, powerDraw: 9 } as const;

const N = MODULE_V1_NUMBERS;
const EVERYWHERE: readonly ModuleContext[] = MODULE_CONTEXTS;
const COMBAT: readonly ModuleContext[] = ["patrol", "shipEvent"];

// The v1 roster. Each entry is also a variety of EQUIPMENT_SLOTS.module (model.ts derives the varieties from this list)
// and has one blueprint (model.ts MODULE_BLUEPRINTS); shipModules.test.ts holds the three equal.
export const UNIVERSAL_MODULES: readonly UniversalModuleDef[] = [
  // Passive: more power for the ship's grid, on every context (a sheet effect).
  { id: "auxiliaryCapacitor", label: "Auxiliary Capacitor", category: "passive", contexts: EVERYWHERE, effect: { key: "powerOutput", magnitude: N.auxiliaryCapacitor.powerOutput }, powerDraw: N.auxiliaryCapacitor.powerDraw, source: "craft" },
  // Passive: a bigger combat hull pool.
  { id: "structuralBracing", label: "Structural Bracing", category: "passive", contexts: COMBAT, effect: { key: "hullIntegrity", magnitude: N.structuralBracing.hullIntegrity }, powerDraw: N.structuralBracing.powerDraw, source: "craft" },
  // Proc: on a hit TAKEN (EM-6's "on hit"), a chance to arc a small EW hit back at the attacker.
  { id: "arcDischarger", label: "Arc Discharger", category: "proc", contexts: COMBAT, trigger: { kind: "onHit" }, chance: N.arcDischarger.chance, effect: { key: "arcDamage", magnitude: N.arcDischarger.arcDamage }, powerDraw: N.arcDischarger.powerDraw, source: "craft" },
  // Proc: each delivered extraction cycle (user 2026-10-22 "Extraction runs only"), a chance of a bonus common haul.
  { id: "prospectorsEcho", label: "Prospector's Echo", category: "proc", contexts: ["mission"], trigger: { kind: "missionCycle" }, chance: N.prospectorsEcho.chance, effect: { key: "bonusHaul", magnitude: N.prospectorsEcho.bonusHaul }, powerDraw: N.prospectorsEcho.powerDraw, source: "craft" },
  // Conditional: while the hull is below a quarter, every projectile hits harder.
  { id: "lastStandProtocol", label: "Last Stand Protocol", category: "conditional", contexts: COMBAT, condition: { kind: "hullBelow", fraction: N.lastStandProtocol.hullBelow }, effect: { key: "weaponDamage", magnitude: N.lastStandProtocol.weaponDamage }, powerDraw: N.lastStandProtocol.powerDraw, source: "craft" },
  // Active (Combat 1.0's own example; M3 one preset rule): once per battle, when the hull falls below half, restore
  // part of the shield pool.
  { id: "shieldSurge", label: "Shield Surge", category: "active", contexts: COMBAT, trigger: { kind: "hullBelow", fraction: N.shieldSurge.hullBelow }, oncePerBattle: true, effect: { key: "shieldRestore", magnitude: N.shieldSurge.shieldRestore }, powerDraw: N.shieldSurge.powerDraw, source: "craft" },
  // Set (2 pieces): the Survey Pair. Together they speed an expedition's scans.
  { id: "longBaselineArray", label: "Long-Baseline Array", category: "set", contexts: ["expedition"], setId: SURVEY_PAIR_SET_ID, effect: { key: "scanSpeedBonus", magnitude: N.surveyPair.scanSpeedBonus }, powerDraw: N.longBaselineArray.powerDraw, source: "craft" },
  { id: "signalIntegrator", label: "Signal Integrator", category: "set", contexts: ["expedition"], setId: SURVEY_PAIR_SET_ID, effect: { key: "scanSpeedBonus", magnitude: N.surveyPair.scanSpeedBonus }, powerDraw: N.signalIntegrator.powerDraw, source: "craft" },
  // Gas Giant Study GG-7 (user call 11, "Three now"): the Ramscoop Collector, a special blueprint opened by a decoded
  // ancient entry (model.ts ramscoopCollectorBp). Passive, on expeditions: a magnetic funnel that makes the nebula sweep
  // bigger and faster ([PROVISIONAL] magnitude and draw in specialBlueprints.ts GG7_NUMBERS). Never a gate: a ship
  // without one sweeps exactly as before.
  { id: RAMSCOOP_COLLECTOR_MODULE, label: "Ramscoop Collector", category: "passive", contexts: ["expedition"], effect: { key: "nebulaSweep", magnitude: GG7_NUMBERS.ramscoopCollector.nebulaSweep }, powerDraw: GG7_NUMBERS.ramscoopCollector.powerDraw, source: "craft" },
  // E-MOD EM-8 (user M6 "Approve all": "each body scanned, a chance to uncover one extra hidden discovery"; E4d: the
  // Precursor Lens relic's first find opens it, model.ts precursorLensBp): the SPECIAL module, its own unique proc.
  // Each body an expedition scans rolls its chance once (the EM-6 body-scanned engine, frozen at dispatch on
  // Expedition.moduleScanProcs); a landed roll adds one more discovery. The piece's rarity and quality lift the chance
  // (MODULE_SCALE_ON), never the count. One per ship like every module (user M8 "One per ship; the Precursor Lens too").
  { id: PRECURSOR_LENS_MODULE, label: "Precursor Lens", category: "special", contexts: ["expedition"], trigger: { kind: "bodyScanned" }, chance: PRECURSOR_LENS_NUMBERS.chance, effect: { key: "extraDiscovery", magnitude: PRECURSOR_LENS_NUMBERS.extraDiscovery }, powerDraw: PRECURSOR_LENS_NUMBERS.powerDraw, source: "discovery" },
];

// The effect keys each category's engine reads TODAY. A category absent here has no engine yet, so no catalog entry of
// that category may exist until its slice adds the engine and the key here: the "nothing inert" rule, enforced by
// validateUniversalModuleDef.
// EM-6 adds Proc, Active and Special (the Precursor Lens is proc-shaped: a chance per trigger). An Active is a combat
// auto-cast (user M3, 2026-10-19, "One preset rule"), so it reads the combat effects only. EM-7 adds the Set: its key
// is a set tier's bonus line (gearSets.ts), read by the expedition dispatch (expedition.ts expeditionGearBonuses).
const TRIGGERED_KEYS: readonly ModuleEffectKey[] = ["arcDamage", "shieldRestore", "bonusHaul", "extraDiscovery"];
export const MODULE_ENGINE_KEYS: Readonly<Partial<Record<UniversalModuleCategory, readonly ModuleEffectKey[]>>> = {
  passive: ["powerOutput", "hullIntegrity", "nebulaSweep"],
  conditional: ["weaponDamage"],
  proc: TRIGGERED_KEYS,
  active: ["arcDamage", "shieldRestore"],
  special: TRIGGERED_KEYS,
  set: ["scanSpeedBonus"],
};

// EM-7: where each set key acts (a set bonus must list exactly the contexts its consumer reads).
export const MODULE_SET_KEY_CONTEXTS: Readonly<Partial<Record<ModuleEffectKey, readonly ModuleContext[]>>> = {
  scanSpeedBonus: ["expedition"],
};

// ============================================================================
// EM-6: the trigger rules (user M4, 2026-10-19, "Original proposal")
// ============================================================================

export type ModuleTriggerKind = ModuleTrigger["kind"];
// The six combat triggers, resolved at fixed points of resolveBattle's step loop:
//   battleStart    once, before the first tick (and before an ambush opener).
//   incomingAmbush the ship is the ambushed party: before the ambusher's opening salvo lands.
//   afterAmbush    the ship is the ambushed party: after the opening salvo landed (only when one fired).
//   onHit          the ship took a connecting weapon shot or drone volley (the ambush salvo included).
//   combatTick     every tick, after status effects, before the objective is checked.
//   hullBelow      every tick at the same point, while the hull is strictly below its fraction of the pool.
export type ModuleCombatTriggerKind = "battleStart" | "incomingAmbush" | "afterAmbush" | "onHit" | "combatTick" | "hullBelow";
export const MODULE_COMBAT_TRIGGERS: readonly ModuleCombatTriggerKind[] = ["battleStart", "incomingAmbush", "afterAmbush", "onHit", "combatTick", "hullBelow"];
export function isCombatTrigger(kind: ModuleTriggerKind): kind is ModuleCombatTriggerKind {
  return (MODULE_COMBAT_TRIGGERS as readonly string[]).includes(kind);
}

// Where each trigger can fire, checked PER CONTEXT a module lists (a context its trigger never reaches would be inert
// there). Only an expedition ship event can be an ambush (shipScanEvents.ts, the cloaked vessel); a patrol never is.
export const MODULE_TRIGGER_CONTEXTS: Readonly<Record<ModuleTriggerKind, readonly ModuleContext[]>> = {
  battleStart: ["patrol", "shipEvent"],
  incomingAmbush: ["shipEvent"],
  afterAmbush: ["shipEvent"],
  onHit: ["patrol", "shipEvent"],
  combatTick: ["patrol", "shipEvent"],
  hullBelow: ["patrol", "shipEvent"],
  missionCycle: ["mission"],
  bodyScanned: ["expedition"],
};

// Which effects each trigger's engine applies.
const COMBAT_EFFECTS: readonly ModuleEffectKey[] = ["arcDamage", "shieldRestore"];
export const MODULE_TRIGGER_EFFECTS: Readonly<Record<ModuleTriggerKind, readonly ModuleEffectKey[]>> = {
  battleStart: COMBAT_EFFECTS,
  incomingAmbush: COMBAT_EFFECTS,
  afterAmbush: COMBAT_EFFECTS,
  onHit: COMBAT_EFFECTS,
  combatTick: COMBAT_EFFECTS,
  hullBelow: COMBAT_EFFECTS,
  missionCycle: ["bonusHaul"],
  bodyScanned: ["extraDiscovery"],
};

// The damage family of a module arc (user 2026-10-22: Electromagnetic confirmed). EW is neutral against
// armor and a little weak against shields (resolveBattle.ts FAMILY_VS_*), so an arc reads as a small electrical jolt.
export const MODULE_ARC_FAMILY = "ew" as const;

// [PROVISIONAL] (no answer names it): what a piece's rarity and quality scale (moduleEffectScale) acts on: the
// effect's size, except where the size is a whole count of things (one more discovery), where it lifts the chance
// instead, so a better piece always does more (the user's "everything wired": rarity and quality never inert).
export const MODULE_SCALE_ON: Readonly<Partial<Record<ModuleEffectKey, "magnitude" | "chance">>> = {
  extraDiscovery: "chance",
};

// The effect keys whose magnitude is a whole number (damage points, discoveries); the other triggered keys are
// fractions in (0, 1].
const WHOLE_MAGNITUDE_KEYS: ReadonlySet<ModuleEffectKey> = new Set<ModuleEffectKey>(["arcDamage", "extraDiscovery"]);
const FRACTION_MAGNITUDE_KEYS: ReadonlySet<ModuleEffectKey> = new Set<ModuleEffectKey>(["shieldRestore", "bonusHaul"]);

// ============================================================================
// EM-6: the private streams (odd salts, unique in the repo: salts.test.ts lists this module)
// ============================================================================

// A battle's module stream for the combatant at turn-order index `index`: its own stream, never the combat stream, so
// a ship with modules leaves every other draw of the battle where it was.
export const MODULE_PROC_SALT = 0x4d3a9c65;
// A mission cycle's module stream (the captain, the captain's lifetime count of cycles a module rolled for).
export const MODULE_CYCLE_SALT = 0x2e8b17d3;
// A scanned body's module stream (the run's seed, the body).
export const MODULE_SCAN_SALT = 0x71c6e2a9;

export function moduleProcSeed(battleSeed: number, index: number): number {
  return ((battleSeed >>> 0) ^ MODULE_PROC_SALT ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
}

// The save's own seed (the homeworld seed, tick.ts worksDirectorateSaveSeed) is mixed in, the ML-3 rule, so cycle N of
// captain 1 does not roll alike in every save.
export function moduleCycleSeed(saveSeed: number, captainId: number, lifetimeCycle: number): number {
  const key = `${captainId}|moduleCycle|${lifetimeCycle}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ((saveSeed >>> 0) ^ MODULE_CYCLE_SALT ^ h) >>> 0;
}

export function moduleScanSeed(expeditionSeed: number, bodyIndex: number): number {
  return ((expeditionSeed >>> 0) ^ MODULE_SCAN_SALT ^ Math.imul(bodyIndex + 1, 0x85ebca6b)) >>> 0;
}

// Chances are integers (combat/rng.ts integer-first contract): a chance in [0, 1] is held in MODULE_CHANCE_UNITS.
export const MODULE_CHANCE_UNITS = 1_000_000;
export function moduleChanceUnits(chance: number): number {
  const p = Number.isFinite(chance) ? Math.max(0, Math.min(1, chance)) : 0;
  return Math.round(p * MODULE_CHANCE_UNITS);
}
// Does one roll of a proc at `chanceUnits` land? A certain chance (an Active, or a proc at 1) and a zero chance take no
// draw; anything between takes exactly one integer draw from `rng`.
export function rollModuleChance(rng: Rng, chanceUnits: number): boolean {
  if (chanceUnits >= MODULE_CHANCE_UNITS) return true;
  if (chanceUnits <= 0) return false;
  return rng.nextInt(MODULE_CHANCE_UNITS) < chanceUnits;
}

// ============================================================================
// EM-6: the frozen proc shapes (built from the installed pieces; plain JSON-safe data)
// ============================================================================

// One combat proc or Active as the sim reads it (Combatant.moduleProcs), in module id order.
//   amount: arcDamage whole points; shieldRestore per-mille of the shield pool.
export interface ModuleCombatProc {
  readonly moduleId: string;
  readonly trigger: ModuleCombatTriggerKind;
  readonly hullBelowFraction?: number; // hullBelow only
  readonly chanceUnits: number; // MODULE_CHANCE_UNITS = always (an Active)
  readonly cooldownTicks: number; // 0 = none
  readonly oncePerBattle: boolean;
  readonly effect: "arcDamage" | "shieldRestore";
  readonly amount: number;
}

// One mission-cycle proc (tickCaptainMission), in module id order: `fraction` of the cycle's common haul.
export interface ModuleCycleProc {
  readonly moduleId: string;
  readonly chanceUnits: number;
  readonly fraction: number;
}

// One body-scan proc (Expedition.moduleScanProcs, frozen at dispatch), in module id order: `count` discoveries.
export interface ModuleScanProc {
  readonly moduleId: string;
  readonly chanceUnits: number;
  readonly count: number;
}

// The triggered (Proc, Active, Special) defs installed among `pieces` that act in `context` on `kinds`, with their
// pieces, in module id order (the install order never decides a draw order). Pure.
function triggeredModules(
  pieces: readonly EquipmentInstance[],
  context: ModuleContext,
  kinds: readonly ModuleTriggerKind[],
  catalog: readonly UniversalModuleDef[],
): { def: UniversalModuleDef; piece: EquipmentInstance }[] {
  const out: { def: UniversalModuleDef; piece: EquipmentInstance }[] = [];
  for (const piece of pieces) {
    const def = pieceModuleDef(piece, catalog);
    if (def === undefined || def.trigger === undefined) continue;
    if (def.category !== "proc" && def.category !== "active" && def.category !== "special") continue;
    if (!kinds.includes(def.trigger.kind) || !moduleActsIn(def, context)) continue;
    if (!MODULE_TRIGGER_EFFECTS[def.trigger.kind].includes(def.effect.key)) continue;
    out.push({ def, piece });
  }
  return out.sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));
}

// A triggered def's chance in units: an Active always casts; a proc's chance, lifted by the piece's scale when the
// scale acts on the chance (MODULE_SCALE_ON).
function procChanceUnits(def: UniversalModuleDef, scale: number): number {
  if (def.category === "active") return MODULE_CHANCE_UNITS;
  const chance = def.chance ?? 0;
  return moduleChanceUnits(MODULE_SCALE_ON[def.effect.key] === "chance" ? chance * scale : chance);
}
function procMagnitude(def: UniversalModuleDef, scale: number): number {
  return MODULE_SCALE_ON[def.effect.key] === "chance" ? def.effect.magnitude : def.effect.magnitude * scale;
}

// Every combat proc and Active installed among `pieces` that acts in `context`. Empty for a ship with none. Integer at
// the fold: arc damage rounds to whole points, a shield restore to whole per-mille (the whole pool at most). Pure.
export function moduleCombatProcs(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  context: ModuleCombatContext,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): ModuleCombatProc[] {
  return triggeredModules(pieces, context, MODULE_COMBAT_TRIGGERS, catalog).map(({ def, piece }) => {
    const scale = scaleOf(piece);
    const trigger = def.trigger!;
    const magnitude = procMagnitude(def, scale);
    const effect = def.effect.key as "arcDamage" | "shieldRestore";
    return {
      moduleId: def.id,
      trigger: trigger.kind as ModuleCombatTriggerKind,
      ...(trigger.kind === "hullBelow" ? { hullBelowFraction: trigger.fraction } : {}),
      chanceUnits: procChanceUnits(def, scale),
      cooldownTicks: Math.max(0, Math.floor(def.cooldownTicks ?? 0)),
      oncePerBattle: def.oncePerBattle === true,
      effect,
      amount: effect === "arcDamage" ? Math.max(0, Math.round(magnitude)) : Math.max(0, Math.min(1000, Math.round(magnitude * 1000))),
    };
  });
}

// Every mission-cycle proc installed among `pieces` (the "mission" context). Empty for a ship with none. Pure.
export function moduleCycleProcs(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): ModuleCycleProc[] {
  return triggeredModules(pieces, "mission", ["missionCycle"], catalog).map(({ def, piece }) => {
    const scale = scaleOf(piece);
    return { moduleId: def.id, chanceUnits: procChanceUnits(def, scale), fraction: procMagnitude(def, scale) };
  });
}

// Every body-scan proc installed among `pieces` (the "expedition" context). Empty for a ship with none. Pure.
export function moduleScanProcs(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): ModuleScanProc[] {
  return triggeredModules(pieces, "expedition", ["bodyScanned"], catalog).map(({ def, piece }) => {
    const scale = scaleOf(piece);
    return { moduleId: def.id, chanceUnits: procChanceUnits(def, scale), count: Math.max(0, Math.round(procMagnitude(def, scale))) };
  });
}

// The combat proc rule (user M3: an Active's ONE preset rule is its trigger plus once per battle or a cooldown; a proc
// may carry either too). Per battle and per proc: whether it already fired (once per battle) and the tick it last
// fired (the cooldown). A proc whose rule holds then rolls its chance (rollModuleChance).
export interface ModuleProcClock {
  fired: boolean;
  lastTick: number | undefined;
}
export function moduleProcReady(proc: ModuleCombatProc, clock: ModuleProcClock, tick: number): boolean {
  if (proc.oncePerBattle && clock.fired) return false;
  if (proc.cooldownTicks > 0 && clock.lastTick !== undefined && tick - clock.lastTick < proc.cooldownTicks) return false;
  return true;
}

// The bonus a landed bonusHaul adds to a cycle's common haul: `fraction` of it. A whole haul stays whole (rounded down,
// no draw); an already fractional haul (a yield bonus) scales exactly, as fractional amounts always do.
// EM-7 review (noted, not banked): the floor drops the remainder, so a landed Echo on a 1-unit cycle adds nothing; every
// real extraction cycle hauls tens of units, and banking the remainder would need a stored per-captain carry (a save
// field), so it is logged for the balancing patch instead.
export function bonusHaulUnits(common: number, fraction: number): number {
  if (!(common > 0) || !(fraction > 0)) return 0;
  return Number.isInteger(common) ? Math.floor(common * fraction + 1e-9) : common * fraction;
}

// ============================================================================
// The slot rules
// ============================================================================

// The slots SHIP_TYPES[hull].moduleSlots caps TOGETHER (user M1, 2026-10-17, "Separate counts": "moduleSlots caps only
// the universal modules and spec utility"). The bridge, quarters and sensor keep their own slots and never count.
export const MODULE_SLOT_SHARING_TYPES: ReadonlySet<EquipmentSlotType> = new Set<EquipmentSlotType>(["module", "specUtility"]);

// Does a hull of this spec carry a Spec Utility slot? Every SPECIALIZED hull does; the General Freighter has none (E4d).
// THE one predicate: the install gate's shared-slot count, moduleSlotsUsed, the Armory slot set (armory.ts) and Ship
// Systems (ShipSystemsPanel hasSpecUtilitySlot) all read it. EM-7 review: every save's starting Freighter is seeded a
// Standard-Issue Spec Utility it shows no slot for (and so can never remove); counting that piece filled the
// Freighter's one module slot for good. Pure.
export function hullHasSpecUtilitySlot(spec: string): boolean {
  return spec !== "general";
}

// How many of the shared module slots `pieces` fill: every module, and the Spec Utility only on a hull that has the
// slot (`hasSpecUtilitySlot`, from hullHasSpecUtilitySlot; a stray utility on the Freighter fills nothing). Pure.
export function moduleSlotsUsed(pieces: readonly Pick<EquipmentInstance, "slotType">[], hasSpecUtilitySlot = true): number {
  let n = 0;
  for (const p of pieces) if (p.slotType === "module" || (hasSpecUtilitySlot && p.slotType === "specUtility")) n++;
  return n;
}

// User 2026-10-26 ("Armory loadouts only (Recommended)"): until EM-10 built the Ship Systems Modules row, a module
// piece was installed and removed through an Armory loadout only, and the item-side Install on... refused every ship
// for a module (memberEquipment.ts installTargetsFor, the moduleArmoryOnly refusal). EM-10 (0.14.0) built the row (its
// per-slot Remove and Install), so this is OFF: Install on... lists each ship with the real gate's verdict.
export const MODULE_INSTALL_ARMORY_ONLY = false;

// The refusal texts every install surface renders (Ship Systems, Install on..., the dev panel). Lower case first word,
// no final period, like every other install reason text. EM-10: the Ship Systems Modules row has a per-slot Remove, so
// the full-slots text is the signed-off mockup's again ("Remove a module first").
export function moduleSlotsFullReasonText(): string {
  return "no free module slot (modules and the Spec Utility share them). Remove a module first";
}
export function moduleArmoryOnlyReasonText(): string {
  return "install modules through an Armory loadout for now";
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

// The summed magnitude of every installed PASSIVE module carrying `key` that acts in `context` ("everywhere": only a
// module listing every context, the ship sheet's rule). One copy per ship (M8) and one catalog module per engine key
// (validateUniversalModuleCatalog) mean nothing stacks today; a second module sharing a key must fold through the D23
// diminishing curve, never a plain sum (the catalog test refuses it until then). Pure.
export function modulePassiveTotal(
  pieces: readonly EquipmentInstance[],
  key: ModuleEffectKey,
  scaleOf: ModuleScaleOf,
  context: ModuleContext | "everywhere",
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): number {
  let total = 0;
  for (const piece of pieces) {
    const def = pieceModuleDef(piece, catalog);
    if (def === undefined || def.category !== "passive" || def.effect.key !== key) continue;
    if (!(context === "everywhere" ? moduleActsEverywhere(def) : moduleActsIn(def, context))) continue;
    total += moduleMagnitude(def, piece, scaleOf);
  }
  return total;
}

// GG-7: the nebula sweep boost of every installed Ramscoop Collector among `pieces` (a fraction; 0 without one), as the
// expedition dispatch freezes it (expedition.ts buildExpedition, Expedition.nebula.ramscoop). Pure.
export function moduleNebulaSweep(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): number {
  return modulePassiveTotal(pieces, "nebulaSweep", scaleOf, "expedition", catalog);
}

// A module's passive power output in whole points (the budget is integer, combat/power.ts): rounded once over the
// ship's total. 0 for a ship with no such module. Pure.
export function modulePowerOutput(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): number {
  const total = modulePassiveTotal(pieces, "powerOutput", scaleOf, "everywhere", catalog);
  return total > 0 ? Math.round(total) : 0;
}

// A Conditional module as combat reads it: the effect while the pool is strictly below the fraction.
export interface ModuleConditionalMod {
  readonly pool: "hull" | "shield";
  readonly fraction: number;
  readonly weaponDamage: number;
}

// Every installed CONDITIONAL module that acts in `context`, as combat folds it (bridge.ts). Empty for a ship with
// none. Pure.
export function moduleConditionals(
  pieces: readonly EquipmentInstance[],
  scaleOf: ModuleScaleOf,
  context: ModuleCombatContext,
  catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES,
): ModuleConditionalMod[] {
  const out: ModuleConditionalMod[] = [];
  for (const piece of pieces) {
    const def = pieceModuleDef(piece, catalog);
    if (def === undefined || def.category !== "conditional" || def.condition === undefined) continue;
    if (!moduleActsIn(def, context)) continue;
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
    if (def.contexts.some((c) => !(MODULE_COMBAT_CONTEXTS as readonly ModuleContext[]).includes(c))) errors.push(`${def.id}: a conditional acts in combat only`);
  } else if (def.condition !== undefined) errors.push(`${def.id}: only a conditional carries a condition`);
  // A ship-sheet effect has no context of its own, so it must name every context (moduleActsEverywhere).
  if (def.category === "passive" && def.effect.key === "powerOutput" && !moduleActsEverywhere(def)) {
    errors.push(`${def.id}: power output acts on the ship sheet, so it must list every context`);
  }
  if (def.category === "passive" && def.effect.key === "hullIntegrity" && def.contexts.some((c) => !(MODULE_COMBAT_CONTEXTS as readonly ModuleContext[]).includes(c))) {
    errors.push(`${def.id}: hull integrity acts in combat only`);
  }
  // GG-7: the nebula sweep boost is read by the expedition dispatch only (frozen on the run's nebula stamp).
  if (def.category === "passive" && def.effect.key === "nebulaSweep" && (def.contexts.length !== 1 || def.contexts[0] !== "expedition")) {
    errors.push(`${def.id}: the nebula sweep boost acts on expeditions only`);
  }
  if (def.category === "passive" && (def.trigger !== undefined || def.chance !== undefined)) errors.push(`${def.id}: a passive has no trigger`);
  // EM-7: a Set names its set (gearSets.ts GEAR_SETS; that the id is a real set is checked by the catalog test, since
  // gearSets.ts imports this file), acts exactly where its key's consumer reads, and its bonus is a fraction in (0, 1].
  if (def.category === "set") {
    if (def.setId === undefined || def.setId === "") errors.push(`${def.id}: a set module needs a setId`);
    const where = MODULE_SET_KEY_CONTEXTS[def.effect.key];
    if (where !== undefined && (def.contexts.length !== where.length || def.contexts.some((c) => !where.includes(c)))) {
      errors.push(`${def.id}: the ${def.effect.key} set bonus acts in ${where.join(", ")} only`);
    }
    if (!(def.effect.magnitude > 0 && def.effect.magnitude <= 1)) errors.push(`${def.id}: ${def.effect.key} is a fraction in (0, 1]`);
  } else if (def.setId !== undefined) errors.push(`${def.id}: only a set module carries a setId`);
  errors.push(...validateTriggeredModuleDef(def));
  return errors;
}

// EM-6: the trigger rules a Proc, an Active or a Special must meet (and that nothing else may carry). Pure.
function validateTriggeredModuleDef(def: UniversalModuleDef): string[] {
  const errors: string[] = [];
  const triggered = def.category === "proc" || def.category === "active" || def.category === "special";
  if (!triggered) {
    if (def.category !== "passive" && (def.trigger !== undefined || def.chance !== undefined)) errors.push(`${def.id}: only a proc, an active or a special has a trigger`);
    if (def.cooldownTicks !== undefined || def.oncePerBattle !== undefined) errors.push(`${def.id}: only a proc, an active or a special has a cooldown or a once-per-battle rule`);
    return errors;
  }
  const trigger = def.trigger;
  if (trigger === undefined) return [`${def.id}: a ${def.category} needs a trigger`];
  // The effect must be one its trigger's engine applies, and every context it lists one its trigger reaches.
  if (!MODULE_TRIGGER_EFFECTS[trigger.kind].includes(def.effect.key)) errors.push(`${def.id}: the ${trigger.kind} trigger does not apply ${def.effect.key}`);
  for (const c of def.contexts) {
    if (!MODULE_TRIGGER_CONTEXTS[trigger.kind].includes(c)) errors.push(`${def.id}: the ${trigger.kind} trigger never fires in the ${c} context`);
  }
  if (trigger.kind === "hullBelow" && !(trigger.fraction > 0 && trigger.fraction < 1)) errors.push(`${def.id}: the hull threshold must be in (0, 1)`);
  // M3 (one preset rule): an Active always casts when its rule holds, once per battle or on a cooldown.
  if (def.category === "active") {
    if (!isCombatTrigger(trigger.kind)) errors.push(`${def.id}: an active casts in combat only`);
    if (def.chance !== undefined) errors.push(`${def.id}: an active has no chance (it casts whenever its rule holds)`);
    if (def.oncePerBattle !== true && !((def.cooldownTicks ?? 0) > 0)) errors.push(`${def.id}: an active's rule is once per battle or a cooldown`);
  } else if (!(def.chance !== undefined && def.chance > 0 && def.chance <= 1)) {
    errors.push(`${def.id}: a ${def.category} needs a chance in (0, 1]`);
  }
  // A threshold held for many ticks must not fire every tick: it needs once per battle or a cooldown.
  if (trigger.kind === "hullBelow" && def.oncePerBattle !== true && !((def.cooldownTicks ?? 0) > 0)) errors.push(`${def.id}: a hull threshold needs once per battle or a cooldown`);
  // Cooldowns and once per battle are battle clocks; nothing reads them outside combat.
  if (!isCombatTrigger(trigger.kind) && (def.cooldownTicks !== undefined || def.oncePerBattle !== undefined)) errors.push(`${def.id}: a cooldown or once per battle acts in combat only`);
  if (def.cooldownTicks !== undefined && !(Number.isInteger(def.cooldownTicks) && def.cooldownTicks > 0)) errors.push(`${def.id}: a cooldown is a whole number of ticks above 0`);
  if (WHOLE_MAGNITUDE_KEYS.has(def.effect.key) && !(Number.isInteger(def.effect.magnitude) && def.effect.magnitude >= 1)) errors.push(`${def.id}: ${def.effect.key} is a whole number of at least 1`);
  if (FRACTION_MAGNITUDE_KEYS.has(def.effect.key) && !(def.effect.magnitude > 0 && def.effect.magnitude <= 1)) errors.push(`${def.id}: ${def.effect.key} is a fraction in (0, 1]`);
  return errors;
}

// Every problem with a catalog: each def, unique ids, and no two modules sharing a Passive or Conditional engine key,
// or one triggered effect key (EM-6: two bonus hauls or two arcs would add up as a plain sum too) (D23: a shared key
// would stack as a plain sum; it must get a diminishing curve first). Pure.
export function validateUniversalModuleCatalog(catalog: readonly UniversalModuleDef[] = UNIVERSAL_MODULES): string[] {
  const errors = catalog.flatMap(validateUniversalModuleDef);
  const ids = new Set<string>();
  const keys = new Set<string>();
  // EM-7: a set key belongs to ONE set (two sets on one bonus line would add up as a plain sum, D23); the pieces of one
  // set share it by design (the set counts them once, as a set).
  const setOfKey = new Map<string, string | undefined>();
  for (const def of catalog) {
    if (ids.has(def.id)) errors.push(`${def.id}: duplicate id`);
    ids.add(def.id);
    if (def.category === "set") {
      const owner = setOfKey.get(def.effect.key);
      if (setOfKey.has(def.effect.key) && owner !== def.setId) errors.push(`${def.id}: a second set on ${def.effect.key} needs a diminishing curve first (D23)`);
      setOfKey.set(def.effect.key, def.setId);
    } else {
      const triggered = def.category === "proc" || def.category === "active" || def.category === "special";
      const k = `${triggered ? "triggered" : def.category}:${def.effect.key}`;
      if (keys.has(k)) errors.push(`${def.id}: a second ${k} module needs a diminishing curve first (D23)`);
      keys.add(k);
    }
  }
  return errors;
}
